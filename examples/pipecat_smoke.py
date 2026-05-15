"""Smoke test: Pipecat's OpenAITTSService against supertonic-server.

This proves that any Pipecat pipeline using `OpenAITTSService` can drop in
supertonic-server by changing `base_url` (no other code changes).

We run the service directly outside a full pipeline (no STT, no LLM, no transport)
to keep the test focused on the TTS contract: instantiate, iterate run_tts(),
collect TTSAudioRawFrame frames, write to WAV.

Run:
    .venv/bin/python examples/pipecat_smoke.py
"""

from __future__ import annotations

import asyncio
import struct
import time
from pathlib import Path

from pipecat.frames.frames import TTSAudioRawFrame
from pipecat.services.openai.tts import OpenAITTSService, OpenAITTSSettings

BASE_URL = "http://localhost:8788/v1"
OUT = Path(__file__).parent.parent / "out"
OUT.mkdir(exist_ok=True)
SAMPLE_RATE = 44100  # supertonic-3 native rate


def _wav_bytes(pcm: bytes, sample_rate: int = SAMPLE_RATE, channels: int = 1, bits: int = 16) -> bytes:
    byte_rate = sample_rate * channels * bits // 8
    block_align = channels * bits // 8
    data_size = len(pcm)
    return (
        b"RIFF"
        + struct.pack("<I", data_size + 36)
        + b"WAVE"
        + b"fmt "
        + struct.pack("<I", 16)
        + struct.pack("<H", 1)
        + struct.pack("<H", channels)
        + struct.pack("<I", sample_rate)
        + struct.pack("<I", byte_rate)
        + struct.pack("<H", block_align)
        + struct.pack("<H", bits)
        + b"data"
        + struct.pack("<I", data_size)
        + pcm
    )


async def synth_one(tts: OpenAITTSService, text: str) -> tuple[bytes, float, float]:
    """Return (pcm_bytes, ttfb_s, total_s) for a single utterance via Pipecat's TTSService."""
    t0 = time.time()
    ttfb: float | None = None
    pcm_parts: list[bytes] = []
    async for frame in tts.run_tts(text, context_id="smoke"):
        if isinstance(frame, TTSAudioRawFrame):
            if ttfb is None:
                ttfb = time.time() - t0
            pcm_parts.append(frame.audio)
    return b"".join(pcm_parts), (ttfb or float("nan")), time.time() - t0


async def main() -> None:
    tts = OpenAITTSService(
        api_key="not-needed",
        base_url=BASE_URL,
        settings=OpenAITTSSettings(
            model="supertonic-3",
            voice="nova",
        ),
        sample_rate=SAMPLE_RATE,
    )
    # Pipecat sets _sample_rate from a StartFrame inside a real pipeline. We're
    # invoking the service standalone for this smoke test, so seed it directly.
    tts._sample_rate = SAMPLE_RATE

    cases = [
        ("nova", "Hello from Pipecat using the Supertonic local server. This message is being streamed."),
        ("alloy", "Now Alloy says hi. Streaming TTS keeps latency low for voice agents."),
        ("ash", "And here is Ash, a male voice."),
    ]

    for voice, text in cases:
        await tts.set_voice(voice)
        pcm, ttfb, total = await synth_one(tts, text)
        path = OUT / f"pipecat_{voice}.wav"
        path.write_bytes(_wav_bytes(pcm))
        audio_s = len(pcm) // 2 / SAMPLE_RATE
        rtf = total / audio_s if audio_s else 0.0
        print(
            f"voice={voice:>6}  TTFB={ttfb*1000:5.0f}ms  total={total*1000:5.0f}ms  "
            f"audio={audio_s:5.2f}s  RTF={rtf:.3f}  -> {path.name}"
        )


if __name__ == "__main__":
    asyncio.run(main())
