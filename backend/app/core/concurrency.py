"""fixes107: admit at most `limit` API requests at once.

A request holds its DB connection from its first query until FastAPI closes
its `get_db` session — after the response is sent and its background tasks
ran — including the gaps where it waits for a worker thread (between the
auth dependency and the endpoint, and before response validation). Under a
burst, more requests than connections reached that point, every worker
thread then waited on the empty pool, and the server stopped making
progress until pool timeouts fired.

`limit` equals the request pool (database.REQUEST_CONNECTIONS) and every
admitted request uses at most one request-pool connection (all other
sessions use the side pool), so an admitted request never waits for a
connection. Requests over the limit wait here in the event loop, holding no
thread and no connection; after `queue_timeout` they get a 503 without ever
reaching the handler. The slot is released when the inner app returns,
which is after get_db closed the session (FastAPI closes it after the
response and its background tasks) — on success, error and cancellation
(tests/test_fixes107.py checks the order against a real QueuePool).
"""
import asyncio
from typing import Optional

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

BUSY_DETAIL = "Server is busy, please try again"
# No DB access — must keep answering even when the API is saturated.
_EXEMPT_PATHS = {"/api/health"}


class ApiConcurrencyLimit:
    def __init__(self, app: ASGIApp, limit: int, queue_timeout: float) -> None:
        self.app = app
        self.limit = limit
        self.queue_timeout = queue_timeout
        # One semaphore per event loop (the test client may run several loops).
        self._semaphores: dict[int, asyncio.Semaphore] = {}

    def _semaphore(self) -> asyncio.Semaphore:
        key = id(asyncio.get_running_loop())
        sem: Optional[asyncio.Semaphore] = self._semaphores.get(key)
        if sem is None:
            sem = self._semaphores[key] = asyncio.Semaphore(self.limit)
        return sem

    def stats(self) -> dict:
        """Slots in use / requests queued, for the running loop's semaphore."""
        sem = self._semaphore()
        return {
            "limit": self.limit,
            "in_use": self.limit - sem._value,
            "waiting": len(sem._waiters or ()),
        }

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        path = scope.get("path", "")
        if (
            scope["type"] != "http"
            or not path.startswith("/api/")
            or path in _EXEMPT_PATHS
            or scope.get("method") == "OPTIONS"
        ):
            await self.app(scope, receive, send)
            return
        sem = self._semaphore()
        try:
            await asyncio.wait_for(sem.acquire(), self.queue_timeout)
        except asyncio.TimeoutError:
            busy = JSONResponse(
                {"detail": BUSY_DETAIL}, status_code=503, headers={"Retry-After": "5"}
            )
            await busy(scope, receive, send)
            return
        try:
            await self.app(scope, receive, send)
        finally:
            sem.release()
