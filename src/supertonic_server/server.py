"""FastAPI app: OpenAI-compatible /v1/audio/speech, voice listing, health, model list."""

from __future__ import annotations

import logging
import time
from contextlib import asynccontextmanager
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from supertonic_server import __version__
from supertonic_server.audio import MEDIA_TYPES, SUPPORTED_FORMATS, stream_in_format
from supertonic_server.config import Settings
from supertonic_server.engine import SupertonicEngine
from supertonic_server.voices import OPENAI_VOICE_ALIASES, SUPERTONIC_VOICES, list_voices, resolve_voice

log = logging.getLogger("supertonic_server")


class SpeechRequest(BaseModel):
    """OpenAI /v1/audio/speech body, plus a few server-specific extensions."""

    model: str = "supertonic-3"
    input: str = Field(..., min_length=1, max_length=20000)
    voice: Optional[str] = None
    response_format: Literal["pcm", "wav", "mp3"] = "mp3"
    speed: float = Field(default=1.05, ge=0.5, le=2.0)
    # Extensions:
    lang: Optional[str] = None
    total_steps: Optional[int] = Field(default=None, ge=4, le=16)
    stream_format: Optional[str] = None  # accepted for OpenAI 4o compatibility; ignored


def build_app(settings: Settings) -> FastAPI:
    engine = SupertonicEngine(settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        log.info("Loading Supertonic model (this is a one-time cost)…")
        t0 = time.time()
        engine.load()
        log.info("Model load total: %.2fs", time.time() - t0)
        await engine.warmup()
        app.state.engine = engine
        app.state.settings = settings
        log.info("Server ready on http://%s:%d", settings.host, settings.port)
        yield
        log.info("Shutting down")

    app = FastAPI(
        title="supertonic-server",
        version=__version__,
        description="OpenAI-compatible TTS server for Supertonic-3.",
        lifespan=lifespan,
    )

    if settings.cors_allow_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_allow_origins,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    @app.get("/healthz")
    async def healthz(request: Request) -> dict:
        eng: SupertonicEngine = request.app.state.engine
        return {
            "status": "ok",
            "version": __version__,
            "model": settings.model_name,
            "sample_rate": eng.sample_rate,
            "voices": eng.voice_names,
            "languages": eng.lang_codes,
            "device_request": settings.device,
        }

    @app.get("/v1/models")
    async def list_models() -> dict:
        return {
            "object": "list",
            "data": [
                {
                    "id": settings.model_name,
                    "object": "model",
                    "owned_by": "supertonic",
                },
                # Common aliases people send by reflex
                {"id": "tts-1", "object": "model", "owned_by": "supertonic"},
                {"id": "tts-1-hd", "object": "model", "owned_by": "supertonic"},
                {"id": "gpt-4o-mini-tts", "object": "model", "owned_by": "supertonic"},
            ],
        }

    @app.get("/v1/voices")
    async def get_voices() -> dict:
        return {
            "object": "list",
            "supertonic_voices": list(SUPERTONIC_VOICES),
            "openai_aliases": OPENAI_VOICE_ALIASES,
            "data": list_voices(),
        }

    @app.post("/v1/audio/speech")
    async def create_speech(req: SpeechRequest, request: Request):
        eng: SupertonicEngine = request.app.state.engine

        if req.response_format not in SUPPORTED_FORMATS:
            raise HTTPException(
                400,
                f"Unsupported response_format {req.response_format!r}. "
                f"Supported: {SUPPORTED_FORMATS}",
            )

        voice = resolve_voice(req.voice, settings.default_voice)
        if voice not in eng.voice_names:
            raise HTTPException(400, f"Unknown voice {req.voice!r} (resolved to {voice}).")

        lang = (req.lang or settings.default_lang).lower()
        if lang not in eng.lang_codes:
            raise HTTPException(
                400,
                f"Unknown language {lang!r}. Supported: {eng.lang_codes}",
            )

        total_steps = req.total_steps or settings.default_total_steps
        speed = req.speed

        log.info(
            "speech: chars=%d voice=%s lang=%s fmt=%s speed=%.2f steps=%d",
            len(req.input),
            voice,
            lang,
            req.response_format,
            speed,
            total_steps,
        )

        pcm_stream = eng.stream(
            req.input,
            voice=voice,
            lang=lang,
            speed=speed,
            total_steps=total_steps,
        )
        body = stream_in_format(pcm_stream, req.response_format, eng.sample_rate)
        media_type = MEDIA_TYPES[req.response_format]
        headers = {
            "Cache-Control": "no-store",
            "X-Sample-Rate": str(eng.sample_rate),
            "X-Voice": voice,
            "X-Language": lang,
            "X-Model": settings.model_name,
        }
        if req.response_format == "pcm":
            headers["X-Audio-Encoding"] = f"pcm_s16le_{eng.sample_rate}_1ch"
        return StreamingResponse(body, media_type=media_type, headers=headers)

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception):
        log.exception("Unhandled error")
        return JSONResponse(status_code=500, content={"error": {"message": str(exc), "type": type(exc).__name__}})

    return app
