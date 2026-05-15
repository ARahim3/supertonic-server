"""CLI entry point: build settings from flags, then hand off to uvicorn."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

import click
import uvicorn

from supertonic_server.config import Device, Settings


def _make_settings(**overrides) -> Settings:
    """Build a Settings object, overriding env/.env values with non-None CLI flags."""
    overrides = {k: v for k, v in overrides.items() if v is not None}
    return Settings(**overrides)


@click.command(context_settings={"show_default": True, "help_option_names": ["-h", "--help"]})
@click.option("--host", default=None, help="Bind address.")
@click.option("--port", type=int, default=None, help="Bind port.")
@click.option(
    "--device",
    type=click.Choice(["auto", "cpu", "coreml", "cuda"]),
    default=None,
    help="ONNX execution provider. 'auto' picks CUDA > CoreML > CPU based on availability.",
)
@click.option(
    "--model",
    "model_name",
    type=click.Choice(["supertonic", "supertonic-2", "supertonic-3"]),
    default=None,
    help="Supertonic model version.",
)
@click.option("--model-dir", type=click.Path(path_type=Path), default=None, help="Local model cache dir.")
@click.option("--voice", "default_voice", default=None, help="Default voice (F1-F5, M1-M5).")
@click.option("--lang", "default_lang", default=None, help="Default language code (e.g. en, ko, ja).")
@click.option("--speed", "default_speed", type=float, default=None, help="Default speed multiplier.")
@click.option(
    "--total-steps",
    "default_total_steps",
    type=int,
    default=None,
    help="Diffusion steps. Lower = faster, higher = better quality. 4..16.",
)
@click.option("--intra-threads", "intra_op_threads", type=int, default=None, help="ONNX intra-op threads.")
@click.option("--inter-threads", "inter_op_threads", type=int, default=None, help="ONNX inter-op threads.")
@click.option("--max-concurrent", "max_concurrent_synth", type=int, default=None,
              help="Max concurrent synthesis ops. 1 avoids CPU thrashing.")
@click.option("--no-warmup", "warmup_flag", flag_value=False, default=None,
              help="Skip startup warmup (first request will be slow).")
@click.option("--warmup-text", default=None, help="Text used for the startup warmup synthesis.")
@click.option("--log-level", default=None, help="uvicorn/python log level (debug, info, warning, error).")
@click.option("--reload", is_flag=True, default=False, help="Auto-reload (dev only).")
@click.version_option()
def main(
    host: Optional[str],
    port: Optional[int],
    device: Optional[Device],
    model_name: Optional[str],
    model_dir: Optional[Path],
    default_voice: Optional[str],
    default_lang: Optional[str],
    default_speed: Optional[float],
    default_total_steps: Optional[int],
    intra_op_threads: Optional[int],
    inter_op_threads: Optional[int],
    max_concurrent_synth: Optional[int],
    warmup_flag: Optional[bool],
    warmup_text: Optional[str],
    log_level: Optional[str],
    reload: bool,
) -> None:
    """Run the supertonic-server OpenAI-compatible TTS HTTP server."""

    overrides = dict(
        host=host,
        port=port,
        device=device,
        model_name=model_name,
        model_dir=model_dir,
        default_voice=default_voice,
        default_lang=default_lang,
        default_speed=default_speed,
        default_total_steps=default_total_steps,
        intra_op_threads=intra_op_threads,
        inter_op_threads=inter_op_threads,
        max_concurrent_synth=max_concurrent_synth,
        warmup=warmup_flag,
        warmup_text=warmup_text,
        log_level=log_level,
    )
    settings = _make_settings(**overrides)

    logging.basicConfig(
        level=settings.log_level.upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    # Stash settings for the worker process (works with --reload too)
    import os
    if settings.model_dir:
        os.environ["SUPERTONIC_MODEL_DIR"] = str(settings.model_dir)
    os.environ["SUPERTONIC_DEVICE"] = settings.device
    os.environ["SUPERTONIC_MODEL_NAME"] = settings.model_name
    os.environ["SUPERTONIC_DEFAULT_VOICE"] = settings.default_voice
    os.environ["SUPERTONIC_DEFAULT_LANG"] = settings.default_lang
    os.environ["SUPERTONIC_DEFAULT_SPEED"] = str(settings.default_speed)
    os.environ["SUPERTONIC_DEFAULT_TOTAL_STEPS"] = str(settings.default_total_steps)
    os.environ["SUPERTONIC_WARMUP"] = "1" if settings.warmup else "0"
    if settings.warmup_text:
        os.environ["SUPERTONIC_WARMUP_TEXT"] = settings.warmup_text
    if settings.intra_op_threads is not None:
        os.environ["SUPERTONIC_INTRA_OP_THREADS"] = str(settings.intra_op_threads)
    if settings.inter_op_threads is not None:
        os.environ["SUPERTONIC_INTER_OP_THREADS"] = str(settings.inter_op_threads)
    os.environ["SUPERTONIC_MAX_CONCURRENT_SYNTH"] = str(settings.max_concurrent_synth)

    uvicorn.run(
        "supertonic_server.app:app",
        host=settings.host,
        port=settings.port,
        log_level=settings.log_level,
        reload=reload,
    )


if __name__ == "__main__":
    main()
