"""In-process Observatory: ring buffer of recent requests + live aggregates.

Voice agents running against a cloud TTS API can't see what's happening server-side.
We run locally — we *can*. This module is what makes that visible:

  - A bounded ring buffer of recent RequestRecords (default 100).
  - Live aggregates computed on demand: rps over 1 minute, percentile TTFB / RTF,
    error rate, in-flight count.
  - Prometheus text-format exposition for any scraper that wants it.

It's thread-safe (HTTP handlers + the engine's executor threads may both touch it),
uses only stdlib + numpy (already a hard dep), and adds ~0 latency to a request —
record() is one lock + append.
"""

from __future__ import annotations

import threading
import time
from collections import deque
from dataclasses import asdict, dataclass
from typing import Optional

import numpy as np


@dataclass
class RequestRecord:
    id: int
    started_at: float         # epoch seconds
    ended_at: float           # epoch seconds
    text_snippet: str         # first ~80 chars
    text_length: int
    voice: str
    lang: str
    format: str               # pcm | wav | mp3 | ws-pcm
    status: str               # ok | cancelled | error
    ttfb_ms: float
    total_ms: float
    bytes: int
    audio_s: float            # 0.0 if unknown (e.g. mp3 not decoded)
    rtf: float                # 0.0 if audio_s == 0
    error: Optional[str] = None
    transport: str = "http"   # http | ws


class Observatory:
    """Singleton-style metrics aggregator. One per `build_app()` call."""

    def __init__(self, buffer_size: int = 100) -> None:
        self._lock = threading.Lock()
        self._buf: deque[RequestRecord] = deque(maxlen=max(1, buffer_size))
        self._next_id = 1
        self._active = 0
        self._started_at = time.time()
        # cumulative counters survive ring-buffer eviction
        self._totals = {"ok": 0, "cancelled": 0, "error": 0}
        self._bytes_total = 0
        self._audio_s_total = 0.0

    # ---- recording ----

    def start(self) -> int:
        """Reserve an id and bump the in-flight counter."""
        with self._lock:
            self._active += 1
            rid = self._next_id
            self._next_id += 1
            return rid

    def finish(self, record: RequestRecord) -> None:
        with self._lock:
            self._active = max(0, self._active - 1)
            self._buf.append(record)
            self._totals[record.status] = self._totals.get(record.status, 0) + 1
            self._bytes_total += int(record.bytes)
            if record.audio_s > 0:
                self._audio_s_total += float(record.audio_s)

    # ---- reading ----

    def snapshot(self) -> dict:
        """Return live aggregates + cumulative totals as plain JSON-able dict."""
        with self._lock:
            records = list(self._buf)
            active = self._active
            totals = dict(self._totals)
            bytes_total = self._bytes_total
            audio_s_total = self._audio_s_total
            uptime_s = time.time() - self._started_at
            buffer_capacity = self._buf.maxlen or 0

        # Aggregates computed outside the lock — the snapshot list is detached.
        ok_records = [r for r in records if r.status == "ok"]
        ttfbs = np.asarray([r.ttfb_ms for r in ok_records], dtype=np.float64)
        rtfs = np.asarray([r.rtf for r in ok_records if r.rtf > 0], dtype=np.float64)

        now = time.time()
        recent_1m = [r for r in records if now - r.ended_at <= 60.0]
        recent_5m = [r for r in records if now - r.ended_at <= 300.0]
        window_count = len(records)
        err_count = sum(1 for r in records if r.status == "error")

        return {
            "uptime_s": round(uptime_s, 2),
            "active": active,
            "totals": {
                "requests": sum(totals.values()),
                "ok": totals.get("ok", 0),
                "error": totals.get("error", 0),
                "cancelled": totals.get("cancelled", 0),
                "bytes": bytes_total,
                "audio_s": round(audio_s_total, 3),
            },
            "window": {
                "buffer_capacity": buffer_capacity,
                "buffer_used": window_count,
                "rps_1m": round(len(recent_1m) / 60.0, 4),
                "rps_5m": round(len(recent_5m) / 300.0, 4),
                "error_rate": round((err_count / window_count) if window_count else 0.0, 4),
                "ttfb_ms": _percentiles(ttfbs),
                "rtf": _percentiles(rtfs, 4),
            },
        }

    def recent(self, limit: int = 100) -> list[dict]:
        with self._lock:
            tail = list(self._buf)
        tail = tail[-max(0, limit):]
        # newest-first is friendlier for UI consumers
        tail.reverse()
        return [asdict(r) for r in tail]

    def prometheus(self) -> str:
        """Emit a Prometheus text-format exposition. No client lib dependency."""
        snap = self.snapshot()
        totals = snap["totals"]
        win = snap["window"]

        def family(name: str, help_text: str, type_: str, lines: list[str]) -> str:
            return "\n".join([f"# HELP {name} {help_text}", f"# TYPE {name} {type_}", *lines])

        # quantile labels follow Prometheus convention: 0.5, 0.95, 0.99
        Q = (("p50", "0.5"), ("p95", "0.95"), ("p99", "0.99"))

        out: list[str] = []
        out.append(family(
            "supertonic_requests_total",
            "Number of synthesis requests since process start, by terminal status",
            "counter",
            [f'supertonic_requests_total{{status="{s}"}} {totals.get(s, 0)}' for s in ("ok", "error", "cancelled")],
        ))
        out.append(family("supertonic_active_synth", "Synthesis operations currently in flight", "gauge",
                          [f"supertonic_active_synth {snap['active']}"]))
        out.append(family("supertonic_bytes_total", "Total audio bytes served", "counter",
                          [f"supertonic_bytes_total {totals['bytes']}"]))
        out.append(family("supertonic_audio_seconds_total", "Total audio seconds produced", "counter",
                          [f"supertonic_audio_seconds_total {totals['audio_s']}"]))
        out.append(family("supertonic_uptime_seconds", "Process uptime in seconds", "counter",
                          [f"supertonic_uptime_seconds {snap['uptime_s']}"]))
        out.append(family("supertonic_rps_1m", "Requests per second over the last 60 s", "gauge",
                          [f"supertonic_rps_1m {win['rps_1m']}"]))
        out.append(family("supertonic_error_rate", "Error rate over the recent buffer (0..1)", "gauge",
                          [f"supertonic_error_rate {win['error_rate']}"]))
        out.append(family("supertonic_ttfb_ms", "Time-to-first-byte (ms) over the recent window", "summary",
                          [f'supertonic_ttfb_ms{{quantile="{ql}"}} {win["ttfb_ms"][qk]}' for qk, ql in Q]))
        out.append(family("supertonic_rtf", "Real-time factor over the recent window", "summary",
                          [f'supertonic_rtf{{quantile="{ql}"}} {win["rtf"][qk]}' for qk, ql in Q]))
        return "\n".join(out) + "\n"


def _percentiles(arr: np.ndarray, ndigits: int = 2) -> dict[str, float]:
    """Return p50/p95/p99 of an array, or zeros if empty."""
    if arr.size == 0:
        return {"p50": 0.0, "p95": 0.0, "p99": 0.0, "count": 0}
    return {
        "p50": round(float(np.percentile(arr, 50)), ndigits),
        "p95": round(float(np.percentile(arr, 95)), ndigits),
        "p99": round(float(np.percentile(arr, 99)), ndigits),
        "count": int(arr.size),
    }
