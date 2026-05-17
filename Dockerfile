# Cross-platform CPU image for supertonic-server.
#
# Build:  docker build -t supertonic-server .
# Run:    docker run --rm -p 8000:8000 -v supertonic-cache:/root/.cache supertonic-server
#
# This image runs on every platform (Linux / macOS / Windows containers, x86_64 / arm64).
# It includes the CPU build of onnxruntime only; CUDA libraries are NOT in this image.
#
# For NVIDIA GPU on Linux, build `Dockerfile.cuda` instead — that image bundles
# onnxruntime-gpu and a CUDA 12 runtime so the container can actually use the GPU.

FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    SUPERTONIC_HOST=0.0.0.0 \
    SUPERTONIC_PORT=8000

# uv for fast deterministic installs
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && curl -LsSf https://astral.sh/uv/install.sh | sh \
    && mv /root/.local/bin/uv /usr/local/bin/uv

WORKDIR /app
COPY pyproject.toml README.md ./
COPY src ./src

RUN uv pip install --system --no-cache .

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD curl -fsS "http://localhost:${SUPERTONIC_PORT}/healthz" || exit 1

# No CMD that pins --device. The server's default is `--device auto`, which in
# this image resolves to CPU (CoreML / CUDA execution providers are not installed).
# Pinning `--device cpu` here used to silently override `-e SUPERTONIC_DEVICE=...`
# from the environment, which made the GPU story misleading for anyone trying it.
ENTRYPOINT ["supertonic-server"]
