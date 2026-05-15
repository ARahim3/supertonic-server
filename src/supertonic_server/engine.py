"""TTS engine wrapper: model lifecycle, sentence-level streaming, warmup."""

from __future__ import annotations

import asyncio
import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor
from typing import AsyncIterator, Optional

import numpy as np

from supertonic_server.config import Settings, resolve_providers

log = logging.getLogger("supertonic_server.engine")

CJK_LANGS = {"ko", "ja", "zh"}


class SupertonicEngine:
    """Owns the loaded Supertonic TTS model and exposes async, sentence-level streaming."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.sample_rate: int = 0
        self.voice_names: list[str] = []
        self.lang_codes: list[str] = []
        self._tts = None
        self._style_cache: dict[str, object] = {}
        self._executor = ThreadPoolExecutor(
            max_workers=max(1, settings.max_concurrent_synth),
            thread_name_prefix="supertonic-synth",
        )
        self._sem = asyncio.Semaphore(max(1, settings.max_concurrent_synth))

    def load(self) -> None:
        """Construct the underlying TTS model. Patches ONNX providers before init."""
        import supertonic.loader as loader
        from supertonic import TTS, AVAILABLE_LANGUAGES

        providers = resolve_providers(self.settings.device)
        loader.DEFAULT_ONNX_PROVIDERS = providers
        log.info("ONNX providers: %s", providers)

        t0 = time.time()
        self._tts = TTS(
            model=self.settings.model_name,
            model_dir=self.settings.model_dir,
            auto_download=self.settings.auto_download,
            intra_op_num_threads=self.settings.intra_op_threads,
            inter_op_num_threads=self.settings.inter_op_threads,
        )
        log.info("Loaded model %s in %.2fs", self.settings.model_name, time.time() - t0)

        self.sample_rate = int(self._tts.sample_rate)
        self.voice_names = list(self._tts.voice_style_names)
        self.lang_codes = list(AVAILABLE_LANGUAGES)
        log.info(
            "Model ready: sample_rate=%d, voices=%s, langs=%d",
            self.sample_rate,
            self.voice_names,
            len(self.lang_codes),
        )

    def get_style(self, voice_name: str):
        if voice_name not in self._style_cache:
            assert self._tts is not None
            self._style_cache[voice_name] = self._tts.get_voice_style(voice_name=voice_name)
        return self._style_cache[voice_name]

    async def warmup(self) -> None:
        """Force a real synthesis so all 4 ONNX graphs are compiled and cached."""
        if not self.settings.warmup:
            return
        log.info("Warming up with voice=%s text=%r", self.settings.default_voice, self.settings.warmup_text)
        t0 = time.time()
        async for _ in self.stream(
            self.settings.warmup_text,
            voice=self.settings.default_voice,
            lang=self.settings.default_lang,
            speed=self.settings.default_speed,
            total_steps=self.settings.default_total_steps,
        ):
            pass
        log.info("Warmup complete in %.2fs", time.time() - t0)

    async def stream(
        self,
        text: str,
        *,
        voice: str,
        lang: str,
        speed: float,
        total_steps: int,
    ) -> AsyncIterator[bytes]:
        """Yield int16 little-endian PCM bytes, one chunk per sentence-ish unit.

        Pipelined: chunk N+1 is synthesized while the consumer is still receiving chunk N.
        """
        if not text or not text.strip():
            return

        chunks = self._chunk(text, lang)
        if not chunks:
            return

        silence_samples = int(self.settings.silence_between_chunks_s * self.sample_rate)
        silence_pcm = np.zeros(silence_samples, dtype=np.int16).tobytes() if silence_samples else b""

        queue: asyncio.Queue[Optional[bytes]] = asyncio.Queue(maxsize=2)
        loop = asyncio.get_running_loop()

        async def producer() -> None:
            try:
                for i, chunk in enumerate(chunks):
                    async with self._sem:
                        wav = await loop.run_in_executor(
                            self._executor,
                            self._synthesize_chunk,
                            chunk,
                            voice,
                            lang,
                            speed,
                            total_steps,
                        )
                    pcm = _to_int16_pcm(wav)
                    if i > 0 and silence_pcm:
                        await queue.put(silence_pcm)
                    await queue.put(pcm)
            except Exception:
                log.exception("Synthesis producer failed")
            finally:
                await queue.put(None)

        producer_task = asyncio.create_task(producer())
        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield item
        finally:
            if not producer_task.done():
                producer_task.cancel()
                try:
                    await producer_task
                except (asyncio.CancelledError, Exception):  # noqa: BLE001
                    pass

    def _synthesize_chunk(
        self,
        chunk: str,
        voice: str,
        lang: str,
        speed: float,
        total_steps: int,
    ) -> np.ndarray:
        """Run one chunk through the model. Runs in the thread-pool."""
        assert self._tts is not None
        style = self.get_style(voice)
        t0 = time.time()
        wav, dur = self._tts.synthesize(
            chunk,
            voice_style=style,
            total_steps=total_steps,
            speed=speed,
            lang=lang,
            silence_duration=0.0,
            verbose=False,
        )
        audio_dur = float(np.asarray(dur).reshape(-1)[0])
        synth_time = time.time() - t0
        rtf = synth_time / audio_dur if audio_dur > 0 else 0.0
        log.debug(
            "chunk synth: chars=%d audio=%.2fs synth=%.2fs RTF=%.3f voice=%s lang=%s",
            len(chunk),
            audio_dur,
            synth_time,
            rtf,
            voice,
            lang,
        )
        return np.asarray(wav).reshape(-1)

    def _chunk(self, text: str, lang: str) -> list[str]:
        """Sentence/clause-level chunker. Aggressive splitting keeps first-chunk latency low."""
        from supertonic.pipeline import chunk_text

        max_len = (
            self.settings.max_chunk_chars_cjk if lang in CJK_LANGS else self.settings.max_chunk_chars
        )
        rough = chunk_text(text, max_len=max_len)

        out: list[str] = []
        for c in rough:
            c = c.strip()
            if not c:
                continue
            out.extend(_split_first_chunk_aggressively(c, lang))
        return [c for c in out if c]


def _to_int16_pcm(wav_f32: np.ndarray) -> bytes:
    """Convert a float32 [-1, 1] waveform to little-endian int16 PCM bytes."""
    flat = np.asarray(wav_f32, dtype=np.float32).reshape(-1)
    flat = np.clip(flat, -1.0, 1.0)
    pcm = (flat * 32767.0).astype(np.int16)
    return pcm.tobytes()


_SENT_BOUNDARY = re.compile(r"(?<=[.!?])\s+")
_CLAUSE_BOUNDARY = re.compile(r"(?<=[,;:])\s+")


def _split_first_chunk_aggressively(chunk: str, lang: str) -> list[str]:
    """If a chunk is still long, split on sentence then clause boundaries.

    This keeps first-chunk latency low for voice-agent use without hurting quality.
    """
    parts = _SENT_BOUNDARY.split(chunk)
    parts = [p.strip() for p in parts if p.strip()]
    if not parts:
        return [chunk]

    out: list[str] = []
    for p in parts:
        if len(p) <= 80:
            out.append(p)
            continue
        sub = _CLAUSE_BOUNDARY.split(p)
        sub = [s.strip() for s in sub if s.strip()]
        out.extend(sub if sub else [p])
    return out
