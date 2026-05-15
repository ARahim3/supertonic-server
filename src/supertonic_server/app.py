"""ASGI entry point for `uvicorn supertonic_server.app:app` and `--reload` workers."""

from supertonic_server.config import Settings
from supertonic_server.server import build_app

settings = Settings()
app = build_app(settings)
