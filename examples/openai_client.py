"""Smoke test: the official OpenAI Python SDK talking to supertonic-server.

If this works, any code that already uses the OpenAI TTS API works against
supertonic-server by changing `base_url` (and `api_key` to anything).

Run:
    .venv/bin/python examples/openai_client.py
"""

from __future__ import annotations

import time
from pathlib import Path

from openai import OpenAI

BASE_URL = "http://localhost:8788/v1"
OUT = Path(__file__).parent.parent / "out"
OUT.mkdir(exist_ok=True)


def main() -> None:
    client = OpenAI(base_url=BASE_URL, api_key="not-needed")

    print("Models:")
    for m in client.models.list().data:
        print(" -", m.id)
    print()

    cases = [
        ("alloy.mp3", "alloy", "Hi! I'm Alloy, mapped to a Supertonic female voice.", "mp3"),
        ("ash.wav", "ash", "And I'm Ash, mapped to a Supertonic male voice.", "wav"),
        ("nova.mp3", "nova", "Hello, this is Nova.", "mp3"),
        ("M3-onyx.mp3", "onyx", "Onyx checking in, low and clear.", "mp3"),
        ("F2-direct.mp3", "F2", "And this voice was requested directly by its Supertonic name.", "mp3"),
    ]

    for filename, voice, text, fmt in cases:
        t0 = time.time()
        out = client.audio.speech.create(
            model="supertonic-3",
            voice=voice,
            input=text,
            response_format=fmt,
            speed=1.05,
        )
        path = OUT / filename
        out.stream_to_file(path)
        size = path.stat().st_size
        print(f"  {voice:>6} -> {filename:>18}  {size:>7}B  {(time.time()-t0)*1000:>6.0f}ms")


if __name__ == "__main__":
    main()
