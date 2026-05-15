"""Voice aliasing so OpenAI clients (and friendlier names) map onto Supertonic voices."""

from __future__ import annotations

SUPERTONIC_VOICES: tuple[str, ...] = ("F1", "F2", "F3", "F4", "F5", "M1", "M2", "M3", "M4", "M5")

# OpenAI's six standard voices mapped onto sensible Supertonic equivalents.
# Picks favor a balanced spread across F/M voices so any client gets variety out of the box.
OPENAI_VOICE_ALIASES: dict[str, str] = {
    "alloy": "F1",
    "ash": "M1",
    "ballad": "M2",
    "cedar": "M3",
    "coral": "F2",
    "echo": "M4",
    "fable": "M5",
    "marin": "F3",
    "nova": "F4",
    "onyx": "M1",
    "sage": "F5",
    "shimmer": "F2",
    "verse": "F1",
}

ALL_ALIASES: dict[str, str] = {
    **OPENAI_VOICE_ALIASES,
    **{v: v for v in SUPERTONIC_VOICES},
    **{v.lower(): v for v in SUPERTONIC_VOICES},
}


def resolve_voice(name: str | None, default: str) -> str:
    """Map an incoming voice name to a real Supertonic voice ID."""
    if not name:
        return default
    return ALL_ALIASES.get(name.strip(), default)


def list_voices() -> list[dict[str, str]]:
    """Return a flat list of every accepted voice name with its resolved Supertonic ID."""
    items: list[dict[str, str]] = []
    seen: set[str] = set()
    for name, target in ALL_ALIASES.items():
        if name in seen:
            continue
        seen.add(name)
        items.append({"id": name, "supertonic_voice": target})
    return items
