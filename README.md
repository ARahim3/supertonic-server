# supertonic-server

[![PyPI](https://img.shields.io/pypi/v/supertonic-server.svg)](https://pypi.org/project/supertonic-server/)
[![Python](https://img.shields.io/pypi/pyversions/supertonic-server.svg)](https://pypi.org/project/supertonic-server/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Model: OpenRAIL-M](https://img.shields.io/badge/model-OpenRAIL--M-purple.svg)](https://huggingface.co/Supertone/supertonic-3)

OpenAI-compatible HTTP server for the [Supertonic-3](https://huggingface.co/Supertone/supertonic-3) on-device TTS model — with streaming, voice aliases, multilingual support, and CPU/CoreML/CUDA acceleration.

Drop-in replacement for OpenAI's `/v1/audio/speech` endpoint. Works with the OpenAI Python SDK, [Pipecat](https://github.com/pipecat-ai/pipecat), LiveKit Agents, OpenWebUI, or anything else that speaks the OpenAI TTS protocol — just point it at `http://localhost:8000/v1`.

## Contents

- [Why](#why) · [vs other open-source TTS servers](#vs-other-open-source-tts-servers)
- [Install](#install) · [Quick start](#quick-start-apple-silicon--linux--windows) · [Docker](#docker) · [CLI](#cli)
- [Endpoints](#endpoints) · [Voices](#voices) · [Languages](#languages)
- [Use from: Python SDK](#use-it-from-python-openai-sdk) · [Pipecat](#use-it-from-pipecat) · [LiveKit](#use-it-from-livekit-agents)
- [Performance](#performance--what-to-expect) · [Tuning](#tuning) · [Troubleshooting](#troubleshooting)
- [Limitations](#limitations) · [License](#license)

## Why

| | Supertonic-3 (via this server) |
|---|---|
| Model size | ~99M params (ONNX) |
| Runtime | ONNX Runtime — runs on **CPU**, CoreML (Apple Silicon), or CUDA |
| Speed | ~6–10× real-time on an M4 Pro CPU/CoreML |
| Languages | 31 + a `na` fallback |
| Voices | 10 presets (F1–F5, M1–M5) + OpenAI aliases (`alloy`, `nova`, `echo`, …) |
| First-byte latency | ~450–650 ms after warmup (default settings) |
| Privacy | Fully local — no cloud calls |
| License | MIT code, OpenRAIL-M weights |

## vs other open-source TTS servers

|  | Local | Streaming | CPU speed | Languages | Quality | Cost |
|---|:---:|:---:|---|:---:|---|---|
| **supertonic-server** (this) | ✅ | sentence | RTF 0.1–0.2 (M-series) | 31 | high | free |
| [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI) | ✅ | sentence | RTF 0.3–0.5 | ~8 | high | free |
| [openedai-speech](https://github.com/matatonic/openedai-speech) (Piper) | ✅ | sentence | RTF 0.05–0.1 | ~30 voices | mid | free |
| [openedai-speech](https://github.com/matatonic/openedai-speech) (XTTS) | ✅ | sentence | RTF 1.0–2.0 | 17 | high | free |
| ElevenLabs API | ❌ | yes | n/a (cloud) | 29+ | top | paid |
| OpenAI TTS API | ❌ | yes | n/a (cloud) | 100+ | high | paid |

"Streaming = sentence" means audio is emitted to the client as each sentence finishes synthesizing — what Pipecat and LiveKit consume natively.

## Install

```bash
# pip
pip install supertonic-server

# uv (recommended — fast, isolated)
uv venv --python 3.12
uv pip install supertonic-server
```

Optional extras:

```bash
pip install "supertonic-server[pipecat]"   # adds pipecat-ai for the Pipecat example
pip install "supertonic-server[dev]"       # adds pytest, httpx, openai for development
```

### From source

```bash
git clone https://github.com/ARahim3/supertonic-server.git
cd supertonic-server
uv venv --python 3.12
uv pip install -e ".[dev]"
```

## Quick start (Apple Silicon / Linux / Windows)

```bash
# 1. Run the server (first run downloads the model — ~250 MB, one-time)
supertonic-server --port 8000

# 2. Speak
curl -X POST http://localhost:8000/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{"input":"Hello, world.","voice":"alloy","response_format":"mp3"}' \
  --output hello.mp3
```

`--device auto` is the default and picks the best available execution provider:
**CUDA** (if `onnxruntime-gpu` is installed and a GPU is present) → **CoreML** (macOS) → **CPU**.

## Docker

```bash
docker build -t supertonic-server .

# CPU (works on any platform incl. Linux, Windows containers, macOS)
docker run --rm -p 8000:8000 -v supertonic-cache:/root/.cache supertonic-server

# NVIDIA GPU (see Dockerfile for full instructions)
docker run --rm --gpus all -p 8000:8000 -v supertonic-cache:/root/.cache \
  -e SUPERTONIC_DEVICE=cuda supertonic-server
```

The mounted volume caches the model weights so subsequent starts skip the download.

## CLI

```
supertonic-server --help
  --host TEXT                     Bind address.
  --port INTEGER                  Bind port.
  --device [auto|cpu|coreml|cuda] ONNX execution provider.
  --model [supertonic|supertonic-2|supertonic-3]
  --model-dir PATH                Local model cache dir.
  --voice TEXT                    Default voice (F1-F5, M1-M5).
  --lang TEXT                     Default language code.
  --speed FLOAT                   Default speed (0.5..2.0).
  --total-steps INTEGER           Diffusion steps (4..16). Lower = faster.
  --intra-threads INTEGER         ONNX intra-op threads.
  --inter-threads INTEGER         ONNX inter-op threads.
  --max-concurrent INTEGER        Concurrent synthesis ops.
  --no-warmup                     Skip startup warmup.
  --warmup-text TEXT              Custom warmup utterance.
  --log-level TEXT                debug | info | warning | error.
  --reload                        Auto-reload (dev only).
```

Every CLI flag also reads from `SUPERTONIC_*` environment variables (e.g. `SUPERTONIC_PORT=9000`).

## Endpoints

### `POST /v1/audio/speech` — OpenAI-compatible

Body:
```jsonc
{
  "model": "supertonic-3",                     // any string; informational
  "input": "Text to speak (up to 20k chars).",
  "voice": "alloy",                            // see Voices below
  "response_format": "mp3",                    // "mp3" | "wav" | "pcm"
  "speed": 1.05,                               // 0.5..2.0
  "lang": "en",                                // extension: 31 codes, see below
  "total_steps": 8                             // extension: 4..16
}
```

The response is HTTP/1.1 chunked transfer — audio bytes stream out as each
sentence finishes synthesizing. Useful headers:

- `X-Sample-Rate: 44100`
- `X-Voice: F1` (the actual Supertonic voice selected, after alias resolution)
- `X-Language: en`
- `X-Audio-Encoding: pcm_s16le_44100_1ch` (PCM only)

### `GET /v1/voices`

Returns every accepted voice name (OpenAI aliases + Supertonic IDs) with the
underlying Supertonic voice each one maps to.

### `GET /v1/models`

OpenAI-style model list (returns `supertonic-3` plus `tts-1`, `tts-1-hd`,
`gpt-4o-mini-tts` as aliases so clients that hard-code those names work).

### `GET /healthz`

`{"status":"ok","model":"supertonic-3","sample_rate":44100,"voices":[…],"languages":[…]}`

## Voices

10 Supertonic presets + OpenAI's 13 standard voice names mapped onto them:

| OpenAI alias | Supertonic | OpenAI alias | Supertonic |
|---|---|---|---|
| alloy | F1 | marin | F3 |
| coral | F2 | nova | F4 |
| sage | F5 | shimmer | F2 |
| verse | F1 | onyx | M1 |
| ash | M1 | ballad | M2 |
| cedar | M3 | echo | M4 |
| fable | M5 | | |

`F1`–`F5` and `M1`–`M5` also pass through unchanged.

## Languages

31 supported language codes plus `na` (fallback): `en, ko, ja, ar, bg, cs, da, de, el, es, et, fi, fr, hi, hr, hu, id, it, lt, lv, nl, pl, pt, ro, ru, sk, sl, sv, tr, uk, vi, na`.

Pass via the `lang` field, e.g. `{"input": "안녕하세요.", "lang": "ko"}`.

## Use it from Python (OpenAI SDK)

```python
from openai import OpenAI

client = OpenAI(base_url="http://localhost:8000/v1", api_key="not-needed")
audio = client.audio.speech.create(
    model="supertonic-3",
    voice="alloy",
    input="Drop-in replacement for OpenAI TTS.",
    response_format="mp3",
)
audio.stream_to_file("hello.mp3")
```

## Use it from Pipecat

```python
from pipecat.services.openai.tts import OpenAITTSService, OpenAITTSSettings

tts = OpenAITTSService(
    api_key="not-needed",
    base_url="http://localhost:8000/v1",
    settings=OpenAITTSSettings(model="supertonic-3", voice="nova"),
    sample_rate=44100,  # supertonic-3 native rate
)
# Plug into any Pipecat pipeline as the TTS service.
```

A standalone smoke test (no full pipeline) lives at `examples/pipecat_smoke.py`.

## Use it from LiveKit Agents

Any LiveKit `openai.TTS` plugin works the same way:

```python
from livekit.plugins import openai

tts = openai.TTS(
    base_url="http://localhost:8000/v1",
    api_key="not-needed",
    model="supertonic-3",
    voice="nova",
)
```

## Performance — what to expect

Numbers from an Apple **M4 Pro** with `--device auto` (CoreML EP):

| Workload | First-byte latency | RTF |
|---|---|---|
| Short single sentence (~3s audio) | ~450–650 ms | 0.10 – 0.25 |
| Multi-sentence (~13 s audio, streaming) | ~620 ms | 0.18 |
| Long form (~20 s audio) | ~600 ms | 0.15 |

Warmup runs a short utterance on startup so the first real request doesn't pay
the CoreML graph-compile tax (~2 s on cold start). Use `--no-warmup` to skip if
you really want to.

## Tuning

- `--total-steps 4` — lower diffusion steps, faster but slightly less expressive.
- `--total-steps 12` — higher quality, ~50% slower.
- `--max-concurrent 2` — allow two simultaneous syntheses (default 1 to avoid CPU thrashing).
- `--device cpu` — skip CoreML/CUDA even when available (more predictable cold start).

## Troubleshooting

**First request is very slow (multi-second).** Either you started with `--no-warmup`, or you're using `--reload` and a save triggered a reload. Restart without `--no-warmup`; the warmup synthesis pre-compiles the CoreML/CUDA graphs so the first real request lands warm.

**Model download is slow or hangs on first run.** The Supertonic-3 weights (~250 MB across 26 files) are pulled from Hugging Face into `~/.cache/supertonic3/`. Check your network, or pre-download:
```bash
huggingface-cli download Supertone/supertonic-3 --local-dir ~/.cache/supertonic3
```

**Audio sounds chipmunked, slowed down, or pitched wrong.** A downstream consumer assumed a different sample rate. supertonic-server emits **44100 Hz** mono int16. In Pipecat, pass `sample_rate=44100` to `OpenAITTSService`. In LiveKit, configure the audio source for 44.1 kHz. The `X-Sample-Rate` response header announces this explicitly.

**Pipecat logs `OpenAI TTS only supports 24000Hz sample rate. Current rate of 44100Hz may cause issues.`** Cosmetic — Pipecat hard-codes the OpenAI cloud rate. Audio still flows correctly at 44.1 kHz; the rate is set by our `sample_rate=44100` constructor argument.

**`CoreML does not support shapes with dimension values of 0` warnings on macOS.** Cosmetic. ONNX Runtime falls back the unsupported subgraphs to CPU; everything still works.

**`Context leak detected, msgtracer returned -1`** on macOS. Cosmetic noise from Apple's tracer. Ignore.

**400 from `/v1/audio/speech`.** Body validation failure. Check that `voice` is in the [Voices](#voices) table or a direct F#/M# ID, `lang` is in the [Languages](#languages) list (or `na`), and `response_format` is one of `mp3`, `wav`, `pcm`.

**Empty or truncated audio.** The client closed the connection mid-stream. The server cancels pending synthesis but lets any in-flight chunk finish (no way to interrupt a running ONNX call). Subsequent requests are unaffected.

## Limitations

- Only `mp3`, `wav`, `pcm` response formats. (Opus/AAC/FLAC are TODO.)
- No voice cloning at runtime — use Supertone's separate Voice Builder for that.
- Diffusion pipeline is per-chunk, so we stream at **sentence** granularity, not sub-sentence. This is the standard granularity Pipecat / LiveKit expect.

## License

- Server code: **MIT**
- Supertonic-3 model weights: **OpenRAIL-M** (downloaded automatically from Hugging Face on first run)
