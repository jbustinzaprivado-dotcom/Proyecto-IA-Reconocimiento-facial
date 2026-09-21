"""A limit of requests per minute that lives in the memory of one process.

It stops brute force and abuse in a single process. With several processes or instances every one
counts on its own, so the real limit is set in the proxy of the hosting too (duda 55).
"""

import threading
import time
from collections import deque

# Beyond this many keys, the ones that have gone quiet are forgotten, so memory cannot grow forever
PRUNE_ABOVE = 10_000


class SlidingWindowLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def allow(
        self, key: str, limit: int, window: float = 60.0, now: float | None = None
    ) -> tuple[bool, int]:
        """(whether it may go on, seconds to wait if not). Counts the request when it may."""
        moment = time.monotonic() if now is None else now
        with self._lock:
            hits = self._hits.setdefault(key, deque())
            while hits and hits[0] <= moment - window:
                hits.popleft()
            if len(hits) >= limit:
                return False, max(1, int(hits[0] + window - moment) + 1)
            hits.append(moment)
            if len(self._hits) > PRUNE_ABOVE:
                self._prune(moment, window)
            return True, 0

    def _prune(self, moment: float, window: float) -> None:
        for key in [k for k, hits in self._hits.items() if not hits or hits[-1] <= moment - window]:
            del self._hits[key]

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()
