"""FastAPI app: OpenAI-compatible /v1/audio/speech, WebSocket TTS, observability."""

from __future__ import annotations

import asyncio
import base64
import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from supertonic_server import __version__
from supertonic_server.audio import MEDIA_TYPES, SUPPORTED_FORMATS, stream_in_format
from supertonic_server.config import Settings
from supertonic_server.engine import SupertonicEngine
from supertonic_server.observability import Observatory, RequestRecord
from supertonic_server.voices import OPENAI_VOICE_ALIASES, SUPERTONIC_VOICES, list_voices, resolve_voice

UI_DIR = Path(__file__).parent / "ui" / "dist"
UI_INDEX = UI_DIR / "index.html"

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
    observatory = Observatory(buffer_size=settings.observability_buffer_size)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        log.info("Loading Supertonic model (this is a one-time cost)…")
        t0 = time.time()
        engine.load()
        log.info("Model load total: %.2fs", time.time() - t0)
        await engine.warmup()
        app.state.engine = engine
        app.state.settings = settings
        app.state.observatory = observatory
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
            "ws_enabled": settings.ws_enabled,
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

    # ----- Observability endpoints --------------------------------------------

    @app.get("/metrics", response_class=PlainTextResponse)
    async def metrics(request: Request) -> str:
        obs: Observatory = request.app.state.observatory
        return obs.prometheus()

    @app.get("/metrics/summary")
    async def metrics_summary(request: Request) -> dict:
        obs: Observatory = request.app.state.observatory
        return obs.snapshot()

    @app.get("/metrics/recent")
    async def metrics_recent(request: Request, limit: int = 100) -> dict:
        obs: Observatory = request.app.state.observatory
        return {"data": obs.recent(limit=limit)}

    # ----- HTTP synthesis -----------------------------------------------------

    @app.post("/v1/audio/speech")
    async def create_speech(req: SpeechRequest, request: Request):
        eng: SupertonicEngine = request.app.state.engine
        obs: Observatory = request.app.state.observatory

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

        rid = obs.start()
        started = time.time()
        # We track PCM bytes separately so audio_s is exact regardless of output format
        # (MP3 byte count can't be converted to seconds without decoding).
        state = {
            "pcm_bytes": 0,
            "out_bytes": 0,
            "ttfb_ms": 0.0,
            "first": True,
            "status": "ok",
            "error": None,
        }

        async def counting_pcm():
            async for chunk in eng.stream(
                req.input, voice=voice, lang=lang, speed=speed, total_steps=total_steps
            ):
                state["pcm_bytes"] += len(chunk)
                yield chunk

        body = stream_in_format(counting_pcm(), req.response_format, eng.sample_rate)

        async def measured():
            try:
                async for chunk in body:
                    if state["first"]:
                        state["ttfb_ms"] = (time.time() - started) * 1000
                        state["first"] = False
                    state["out_bytes"] += len(chunk)
                    yield chunk
            except asyncio.CancelledError:
                state["status"] = "cancelled"
                raise
            except Exception as exc:  # noqa: BLE001
                state["status"] = "error"
                state["error"] = f"{type(exc).__name__}: {exc}"
                raise
            finally:
                ended = time.time()
                audio_s = (state["pcm_bytes"] / 2 / eng.sample_rate) if eng.sample_rate else 0.0
                total_ms = (ended - started) * 1000
                rtf = (total_ms / 1000 / audio_s) if audio_s > 0 else 0.0
                obs.finish(RequestRecord(
                    id=rid,
                    started_at=started,
                    ended_at=ended,
                    text_snippet=req.input[:80],
                    text_length=len(req.input),
                    voice=voice,
                    lang=lang,
                    format=req.response_format,
                    status=state["status"],
                    ttfb_ms=round(state["ttfb_ms"], 2),
                    total_ms=round(total_ms, 2),
                    bytes=state["out_bytes"],
                    audio_s=round(audio_s, 4),
                    rtf=round(rtf, 4),
                    error=state["error"],
                    transport="http",
                ))

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
        return StreamingResponse(measured(), media_type=media_type, headers=headers)

    # ----- WebSocket synthesis -----------------------------------------------

    if settings.ws_enabled:
        @app.websocket("/v1/audio/speech/stream")
        async def ws_speech(ws: WebSocket):
            await ws.accept()
            eng: SupertonicEngine = ws.app.state.engine
            obs: Observatory = ws.app.state.observatory

            cfg = {
                "voice": settings.default_voice,
                "lang": settings.default_lang,
                "speed": float(settings.default_speed),
                "total_steps": int(settings.default_total_steps),
            }
            text_buf: list[str] = []
            synth_task: Optional[asyncio.Task] = None

            await ws.send_json({
                "type": "ready",
                "sample_rate": eng.sample_rate,
                "encoding": f"pcm_s16le_{eng.sample_rate}_1ch",
                "voice": cfg["voice"],
                "lang": cfg["lang"],
            })

            async def synth_and_send(text: str, cfg_local: dict) -> None:
                voice = resolve_voice(cfg_local.get("voice"), settings.default_voice)
                lang = (cfg_local.get("lang") or settings.default_lang).lower()
                speed = float(cfg_local.get("speed", settings.default_speed))
                steps = int(cfg_local.get("total_steps", settings.default_total_steps))
                if voice not in eng.voice_names:
                    await ws.send_json({"type": "error", "message": f"unknown voice {voice!r}"})
                    return
                if lang not in eng.lang_codes:
                    await ws.send_json({"type": "error", "message": f"unknown lang {lang!r}"})
                    return

                rid = obs.start()
                started = time.time()
                ttfb_ms = 0.0
                total_bytes = 0
                first = True
                status = "ok"
                err_str: Optional[str] = None
                try:
                    async for chunk in eng.stream(
                        text, voice=voice, lang=lang, speed=speed, total_steps=steps
                    ):
                        if first:
                            ttfb_ms = (time.time() - started) * 1000
                            first = False
                            await ws.send_json({"type": "audio_start", "ttfb_ms": round(ttfb_ms, 2)})
                        total_bytes += len(chunk)
                        await ws.send_json({
                            "type": "audio",
                            "chunk": base64.b64encode(chunk).decode("ascii"),
                        })
                    total_ms = (time.time() - started) * 1000
                    audio_s = total_bytes / 2 / eng.sample_rate if eng.sample_rate else 0.0
                    rtf = (total_ms / 1000 / audio_s) if audio_s > 0 else 0.0
                    await ws.send_json({
                        "type": "audio_end",
                        "stats": {
                            "ttfb_ms": round(ttfb_ms, 2),
                            "total_ms": round(total_ms, 2),
                            "bytes": total_bytes,
                            "audio_s": round(audio_s, 4),
                            "rtf": round(rtf, 4),
                        },
                    })
                except asyncio.CancelledError:
                    status = "cancelled"
                    try:
                        await ws.send_json({"type": "cancelled"})
                    except Exception:  # noqa: BLE001
                        pass
                    raise
                except Exception as exc:  # noqa: BLE001
                    status = "error"
                    err_str = f"{type(exc).__name__}: {exc}"
                    log.exception("WS synthesis failed")
                    try:
                        await ws.send_json({"type": "error", "message": str(exc)})
                    except Exception:  # noqa: BLE001
                        pass
                finally:
                    ended = time.time()
                    audio_s = total_bytes / 2 / eng.sample_rate if eng.sample_rate else 0.0
                    total_ms = (ended - started) * 1000
                    rtf = (total_ms / 1000 / audio_s) if audio_s > 0 else 0.0
                    obs.finish(RequestRecord(
                        id=rid,
                        started_at=started,
                        ended_at=ended,
                        text_snippet=text[:80],
                        text_length=len(text),
                        voice=voice,
                        lang=lang,
                        format="ws-pcm",
                        status=status,
                        ttfb_ms=round(ttfb_ms, 2),
                        total_ms=round(total_ms, 2),
                        bytes=total_bytes,
                        audio_s=round(audio_s, 4),
                        rtf=round(rtf, 4),
                        error=err_str,
                        transport="ws",
                    ))

            try:
                while True:
                    msg = await ws.receive_json()
                    mtype = (msg.get("type") or "").lower()

                    if mtype == "config":
                        for k in ("voice", "lang"):
                            if k in msg and msg[k] is not None:
                                cfg[k] = str(msg[k])
                        for k in ("speed", "total_steps"):
                            if k in msg and msg[k] is not None:
                                cfg[k] = float(msg[k]) if k == "speed" else int(msg[k])
                        await ws.send_json({"type": "config_ack", "config": cfg})

                    elif mtype == "text":
                        text_buf.append(msg.get("text", ""))

                    elif mtype == "flush":
                        text = "".join(text_buf).strip()
                        text_buf = []
                        if not text:
                            continue
                        # serialize: wait for any in-flight synth (semaphore in engine
                        # would queue anyway, but explicit makes status events tidy)
                        if synth_task is not None and not synth_task.done():
                            try:
                                await synth_task
                            except Exception:  # noqa: BLE001
                                pass
                        synth_task = asyncio.create_task(synth_and_send(text, dict(cfg)))

                    elif mtype == "cancel":
                        text_buf = []
                        if synth_task is not None and not synth_task.done():
                            synth_task.cancel()
                            try:
                                await synth_task
                            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                                pass

                    elif mtype == "close":
                        break

                    else:
                        await ws.send_json({
                            "type": "error",
                            "message": f"unknown message type: {mtype!r}",
                        })
            except WebSocketDisconnect:
                pass
            except Exception:  # noqa: BLE001
                log.exception("WS handler crashed")
            finally:
                if synth_task is not None and not synth_task.done():
                    synth_task.cancel()
                    try:
                        await synth_task
                    except (asyncio.CancelledError, Exception):  # noqa: BLE001
                        pass
                try:
                    await ws.close()
                except Exception:  # noqa: BLE001
                    pass

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception):
        log.exception("Unhandled error")
        return JSONResponse(status_code=500, content={"error": {"message": str(exc), "type": type(exc).__name__}})

    # ---- UI mounting (last, so /v1/* and /healthz take precedence) ----
    if settings.serve_ui and UI_INDEX.exists():
        # Vite is configured with `base: '/static/'` so it emits asset URLs like
        # `/static/assets/index-XXX.js`. We mount `/static` -> the whole dist dir
        # so that path resolves to `ui/dist/assets/index-XXX.js`.
        app.mount("/static", StaticFiles(directory=UI_DIR), name="static")

        @app.get("/", include_in_schema=False)
        async def ui_root() -> FileResponse:
            return FileResponse(UI_INDEX, media_type="text/html")

        log.info("UI mounted at /  (static assets at /static/)")
    elif settings.serve_ui:
        log.warning(
            "UI requested but built assets not found at %s — run `npm run build` in src/supertonic_server/ui/",
            UI_INDEX,
        )

    return app
