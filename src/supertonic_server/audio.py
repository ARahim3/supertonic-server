"""Streaming audio format conversion: PCM passthrough, streaming WAV, streaming MP3."""

from __future__ import annotations

import struct
from typing import AsyncIterator

# WAV uses a uint32 data-size field — max value is 4 GiB minus a few bytes.
# That's ~6 hours of mono 16-bit PCM at 44.1 kHz, way past what voice agents need.
_WAV_STREAM_DATA_SIZE = 0xFFFFFFFF - 36


def build_wav_header(sample_rate: int, channels: int = 1, bits_per_sample: int = 16,
                     data_size: int = _WAV_STREAM_DATA_SIZE) -> bytes:
    """Build a 44-byte RIFF/WAVE header.

    For streaming we set the file/data size fields to a sentinel "very large" value because
    we don't know the final length up front. Players that consume length-prefixed WAVs
    (ffplay, mpv, browsers, sox) all tolerate this.
    """
    byte_rate = sample_rate * channels * bits_per_sample // 8
    block_align = channels * bits_per_sample // 8
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
        + struct.pack("<H", bits_per_sample)
        + b"data"
        + struct.pack("<I", data_size)
    )


async def pcm_passthrough(pcm_stream: AsyncIterator[bytes]) -> AsyncIterator[bytes]:
    async for chunk in pcm_stream:
        if chunk:
            yield chunk


async def pcm_to_wav(pcm_stream: AsyncIterator[bytes], sample_rate: int) -> AsyncIterator[bytes]:
    yield build_wav_header(sample_rate)
    async for chunk in pcm_stream:
        if chunk:
            yield chunk


async def pcm_to_mp3(
    pcm_stream: AsyncIterator[bytes],
    sample_rate: int,
    bit_rate: int = 128,
    quality: int = 2,
) -> AsyncIterator[bytes]:
    """Streaming MP3 encode via lameenc. Output is plain MP3 (no container)."""
    import lameenc

    encoder = lameenc.Encoder()
    encoder.set_bit_rate(bit_rate)
    encoder.set_in_sample_rate(sample_rate)
    encoder.set_channels(1)
    encoder.set_quality(quality)

    async for chunk in pcm_stream:
        if not chunk:
            continue
        out = encoder.encode(chunk)
        if out:
            yield bytes(out)

    tail = encoder.flush()
    if tail:
        yield bytes(tail)


SUPPORTED_FORMATS: tuple[str, ...] = ("pcm", "wav", "mp3")

MEDIA_TYPES = {
    "pcm": "audio/L16",
    "wav": "audio/wav",
    "mp3": "audio/mpeg",
}


def stream_in_format(
    pcm_stream: AsyncIterator[bytes],
    fmt: str,
    sample_rate: int,
) -> AsyncIterator[bytes]:
    fmt = fmt.lower()
    if fmt == "pcm":
        return pcm_passthrough(pcm_stream)
    if fmt == "wav":
        return pcm_to_wav(pcm_stream, sample_rate)
    if fmt == "mp3":
        return pcm_to_mp3(pcm_stream, sample_rate)
    raise ValueError(f"Unsupported response_format: {fmt!r}. Supported: {SUPPORTED_FORMATS}")
