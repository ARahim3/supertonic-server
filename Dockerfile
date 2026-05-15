# Cross-platform CPU image for supertonic-server.
# Build:  docker build -t supertonic-server .
# Run:    docker run --rm -p 8000:8000 -v supertonic-models:/root/.cache supertonic-server
#
# For NVIDIA GPU on Linux:
#   1. Use `--device cuda` and base on `nvidia/cuda:*-runtime` instead of python:3.12-slim.
#   2. Replace `onnxruntime` with `onnxruntime-gpu` in the install step.
#   3. Run with `docker run --gpus all ...`.

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

# default: CPU on every platform. Override with -e SUPERTONIC_DEVICE=cuda (Linux + onnxruntime-gpu).
ENTRYPOINT ["supertonic-server"]
CMD ["--device", "cpu"]
