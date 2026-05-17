"""Smoke test for the WebSocket TTS endpoint at /v1/audio/speech/stream.

Protocol (extension, not OpenAI-compatible):

    client → server   { "type": "config", "voice": "alloy", "lang": "en", "speed": 1.05,
                                          "total_steps": 8 }
                      { "type": "text",   "text": "Hello, " }
                      { "type": "text",   "text": "world. " }
                      { "type": "flush"   }         # finalize and synthesize buffered text
                      { "type": "cancel"  }         # interrupt in-flight synthesis
                      { "type": "close"   }         # graceful close

    server → client   { "type": "ready",         "sample_rate": 44100, ... }
                      { "type": "config_ack",    "config": {...} }
                      { "type": "audio_start",   "ttfb_ms": 142.0 }
                      { "type": "audio",         "chunk": "<base64 PCM>" }
                      { "type": "audio_end",     "stats": { ... } }
                      { "type": "error",         "message": "..." }
                      { "type": "cancelled"      }

Audio chunks are base64-encoded little-endian int16 PCM, mono, at the server's
sample rate (44100 Hz for Supertonic-3).

Run:
    .venv/bin/python examples/ws_smoke.py
"""

from __future__ import annotations

import asyncio
import base64
import json
import time
from pathlib import Path

import websockets

URL = "ws://localhost:8788/v1/audio/speech/stream"
OUT = Path(__file__).parent.parent / "out"
OUT.mkdir(exist_ok=True)


async def main() -> None:
    pcm_chunks: list[bytes] = []
    sample_rate = 44100

    async with websockets.connect(URL) as ws:
        ready = json.loads(await ws.recv())
        assert ready["type"] == "ready", ready
        sample_rate = ready["sample_rate"]
        print(f"connected  sr={sample_rate}  voice={ready.get('voice')}")

        await ws.send(json.dumps({
            "type": "config",
            "voice": "alloy",
            "lang": "en",
            "speed": 1.05,
            "total_steps": 8,
        }))
        ack = json.loads(await ws.recv())
        assert ack["type"] == "config_ack", ack

        for piece in [
            "Hello, ",
            "this is the WebSocket TTS endpoint. ",
            "Sentences arrive as deltas, audio streams back as PCM.",
        ]:
            await ws.send(json.dumps({"type": "text", "text": piece}))

        t_flush = time.time()
        await ws.send(json.dumps({"type": "flush"}))

        ttfb_ms = None
        while True:
            msg = json.loads(await ws.recv())
            t = msg.get("type")
            if t == "audio_start":
                ttfb_ms = msg.get("ttfb_ms")
                wall_ttfb = (time.time() - t_flush) * 1000
                print(f"audio_start ttfb_server={ttfb_ms:.0f}ms ttfb_wall={wall_ttfb:.0f}ms")
            elif t == "audio":
                pcm_chunks.append(base64.b64decode(msg["chunk"]))
            elif t == "audio_end":
                print("audio_end", msg["stats"])
                break
            elif t == "error":
                print("error", msg["message"])
                break
            else:
                print("?", msg)

        await ws.send(json.dumps({"type": "close"}))

    # Build a WAV from the PCM
    pcm = b"".join(pcm_chunks)
    print(f"total pcm bytes: {len(pcm)}  ({len(pcm)/2/sample_rate:.2f}s of audio)")
    out_path = OUT / "ws_smoke.wav"
    _write_wav(out_path, pcm, sample_rate)
    print(f"wrote {out_path}  size={out_path.stat().st_size}B")


def _write_wav(path: Path, pcm: bytes, sample_rate: int) -> None:
    """Wrap raw int16 mono PCM in a real WAV container so anything can play it."""
    import struct
    with open(path, "wb") as f:
        data_size = len(pcm)
        f.write(b"RIFF")
        f.write(struct.pack("<I", 36 + data_size))
        f.write(b"WAVE")
        f.write(b"fmt ")
        f.write(struct.pack("<I", 16))
        f.write(struct.pack("<H", 1))                # PCM
        f.write(struct.pack("<H", 1))                # mono
        f.write(struct.pack("<I", sample_rate))
        f.write(struct.pack("<I", sample_rate * 2))  # byte rate
        f.write(struct.pack("<H", 2))                # block align
        f.write(struct.pack("<H", 16))               # bits
        f.write(b"data")
        f.write(struct.pack("<I", data_size))
        f.write(pcm)


if __name__ == "__main__":
    asyncio.run(main())
