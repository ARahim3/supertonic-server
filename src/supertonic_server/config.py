from __future__ import annotations

from pathlib import Path
from typing import Literal, Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

Device = Literal["auto", "cpu", "coreml", "cuda"]


class Settings(BaseSettings):
    """Server configuration. Every field is overridable via env var (SUPERTONIC_*) or CLI."""

    model_config = SettingsConfigDict(env_prefix="SUPERTONIC_", env_file=".env", extra="ignore")

    host: str = "0.0.0.0"
    port: int = 8000
    log_level: str = "info"

    model_name: Literal["supertonic", "supertonic-2", "supertonic-3"] = "supertonic-3"
    model_dir: Optional[Path] = None
    auto_download: bool = True

    device: Device = "auto"
    intra_op_threads: Optional[int] = None
    inter_op_threads: Optional[int] = None

    default_voice: str = "F1"
    default_lang: str = "en"
    default_speed: float = Field(default=1.05, ge=0.5, le=2.0)
    default_total_steps: int = Field(default=8, ge=4, le=16)
    silence_between_chunks_s: float = Field(default=0.1, ge=0.0, le=1.0)

    max_chunk_chars: int = 240
    max_chunk_chars_cjk: int = 100

    max_concurrent_synth: int = 1

    warmup: bool = True
    warmup_text: str = "Hello, this is a warmup."

    cors_allow_origins: list[str] = ["*"]

    serve_ui: bool = True

    # Observability
    observability_buffer_size: int = Field(default=100, ge=10, le=10_000)

    # WebSocket TTS (extension, not part of OpenAI compat)
    ws_enabled: bool = True


def resolve_providers(device: Device) -> list[str]:
    """Pick ONNX execution providers based on requested device, respecting availability.

    Logs a loud warning if the user asked for a hardware accelerator that isn't
    actually available — silent CPU fallback used to confuse Docker users who'd
    passed `--device cuda` but were running an image without `onnxruntime-gpu`.
    """
    import logging

    import onnxruntime as ort

    log = logging.getLogger("supertonic_server.config")
    available = ort.get_available_providers()

    if device == "cpu":
        return ["CPUExecutionProvider"]
    if device == "coreml":
        if "CoreMLExecutionProvider" in available:
            return ["CoreMLExecutionProvider", "CPUExecutionProvider"]
        log.warning(
            "device=coreml requested but CoreMLExecutionProvider is not available "
            "(available: %s). Falling back to CPU. On non-macOS this is expected.",
            available,
        )
        return ["CPUExecutionProvider"]
    if device == "cuda":
        if "CUDAExecutionProvider" in available:
            return ["CUDAExecutionProvider", "CPUExecutionProvider"]
        log.warning(
            "device=cuda requested but CUDAExecutionProvider is not available "
            "(available: %s). Falling back to CPU. If you're running in Docker, "
            "make sure you built the CUDA image (Dockerfile.cuda) and started the "
            "container with `--gpus all`; the default Dockerfile installs the CPU "
            "build of onnxruntime only.",
            available,
        )
        return ["CPUExecutionProvider"]

    # auto: best available
    if "CUDAExecutionProvider" in available:
        return ["CUDAExecutionProvider", "CPUExecutionProvider"]
    if "CoreMLExecutionProvider" in available:
        return ["CoreMLExecutionProvider", "CPUExecutionProvider"]
    return ["CPUExecutionProvider"]
