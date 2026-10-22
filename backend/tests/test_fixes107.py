"""fixes107: under load the server stopped making progress — worker threads
waited on an empty DB pool while the requests holding its connections waited
for a thread. Covers the connection budget, the request gate (cleanup before
slot release on success / error / background task / cancellation, queue
timeout never entering the handler, slots fully restored after a storm, CORS
on its 503), the error-log cap, and login keeping bcrypt off the DB pool."""
import asyncio
import threading
import time

import httpx
import pytest
from fastapi import BackgroundTasks, Depends, FastAPI
from sqlalchemy import create_engine, event, exc as sa_exc, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import QueuePool

from app import database
from app.config import settings
from app.core import error_log, security
from app.core.concurrency import ApiConcurrencyLimit
from app.database import get_db
from app.main import _is_pool_timeout, app
from app.routers import auth as auth_router
from tests.conftest import TestingSessionLocal


# --- connection budget -------------------------------------------------------
def test_connection_budget_is_unchanged_and_split():
    request = database.REQUEST_POOL_SIZE + database.REQUEST_POOL_OVERFLOW
    side = database.SIDE_POOL_SIZE + database.SIDE_POOL_OVERFLOW
    assert request == database.REQUEST_CONNECTIONS == 25
    assert request + side == 30  # same total as before fixes107
    assert database.REQUEST_POOL_TIMEOUT_SECONDS <= 5


def _gate_in(asgi_app):
    if asgi_app.middleware_stack is None:  # built lazily on the first request
        asgi_app.middleware_stack = asgi_app.build_middleware_stack()
    obj = asgi_app.middleware_stack
    for _ in range(30):
        if isinstance(obj, ApiConcurrencyLimit):
            return obj
        obj = getattr(obj, "app", None)
    raise AssertionError("ApiConcurrencyLimit not in the middleware stack")


def test_gate_limit_matches_request_pool_and_sits_between_cors_and_activity_log():
    assert _gate_in(app).limit == database.REQUEST_CONNECTIONS
    # user_middleware[0] is the outermost.
    names = [m.cls.__name__ for m in app.user_middleware]
    i_gzip = names.index("GZipMiddleware")
    i_cors = names.index("CORSMiddleware")
    i_gate = names.index("ApiConcurrencyLimit")
    i_activity = [i for i, n in enumerate(names) if n == "BaseHTTPMiddleware"]
    assert i_gzip < i_cors < i_gate  # CORS wraps the gate's 503
    assert i_activity and all(i > i_gate for i in i_activity)  # activity log is gated


def test_side_sessions_use_the_side_pool(monkeypatch):
    from app.core import activity_log

    sentinel = object()
    monkeypatch.setattr(database, "SideSessionLocal", lambda: sentinel)
    assert activity_log._session() is sentinel


# --- the gate against a real FastAPI app + a real QueuePool --------------------
class _RecordingSemaphore(asyncio.Semaphore):
    def __init__(self, value, log):
        super().__init__(value)
        self._log = log

    def release(self):
        self._log.append("release")
        super().release()


class _RecordingGate(ApiConcurrencyLimit):
    def __init__(self, app, limit, queue_timeout, log):
        super().__init__(app, limit, queue_timeout)
        self._log = log

    def _semaphore(self):
        key = id(asyncio.get_running_loop())
        if key not in self._semaphores:
            self._semaphores[key] = _RecordingSemaphore(self.limit, self._log)
        return self._semaphores[key]


@pytest.fixture
def gated(tmp_path, monkeypatch):
    """A mini FastAPI app using the REAL get_db over a file-SQLite QueuePool
    (checkout/checkin fire like Postgres), behind a recording gate."""
    log: list[str] = []
    eng = create_engine(
        f"sqlite:///{tmp_path / 'gate.db'}",
        connect_args={"check_same_thread": False},
        poolclass=QueuePool, pool_size=2, max_overflow=0,
    )
    event.listen(eng, "checkout", lambda *a: log.append("checkout"))
    event.listen(eng, "checkin", lambda *a: log.append("checkin"))
    monkeypatch.setattr(database, "SessionLocal", sessionmaker(bind=eng))
    calls = {"slow": 0}
    mini = FastAPI()

    @mini.get("/api/ok")
    def ok(db=Depends(get_db)):
        db.execute(text("select 1"))
        return {"ok": True}

    @mini.get("/api/boom")
    def boom(db=Depends(get_db)):
        db.execute(text("select 1"))
        raise RuntimeError("boom")

    @mini.get("/api/slow")
    def slow(db=Depends(get_db)):
        calls["slow"] += 1
        db.execute(text("select 1"))
        time.sleep(0.3)
        return {"ok": True}

    @mini.get("/api/bg")
    def with_background(background: BackgroundTasks, db=Depends(get_db)):
        db.execute(text("select 1"))
        background.add_task(lambda: (time.sleep(0.1), log.append("background-done")))
        return {"ok": True}

    gate = _RecordingGate(mini, limit=1, queue_timeout=0.15, log=log)
    yield gate, log, calls, eng
    eng.dispose()


def _client(asgi):
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=asgi, raise_app_exceptions=False),
        base_url="http://test",
    )


def test_slot_released_after_connection_returned_on_success(gated):
    gate, log, _, _ = gated

    async def go():
        async with _client(gate) as c:
            assert (await c.get("/api/ok")).status_code == 200

    asyncio.run(go())
    assert log == ["checkout", "checkin", "release"]


def test_slot_released_after_connection_returned_on_error(gated):
    gate, log, _, _ = gated

    async def go():
        async with _client(gate) as c:
            assert (await c.get("/api/boom")).status_code == 500

    asyncio.run(go())
    assert log == ["checkout", "checkin", "release"]


def test_background_task_runs_inside_the_slot_before_the_connection_is_returned(gated):
    # Documents FastAPI's "request" dependency scope: the session (and its
    # connection) is held until background tasks finished — all inside the slot.
    gate, log, _, _ = gated

    async def go():
        async with _client(gate) as c:
            assert (await c.get("/api/bg")).status_code == 200

    asyncio.run(go())
    assert log == ["checkout", "background-done", "checkin", "release"]


def test_cancelled_request_still_returns_its_connection_before_the_slot(gated):
    gate, log, _, eng = gated

    async def go():
        async with _client(gate) as c:
            task = asyncio.create_task(c.get("/api/slow"))
            await asyncio.sleep(0.1)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
        assert gate.stats()["in_use"] == 0

    asyncio.run(go())
    assert "release" in log and "checkin" in log
    assert log.index("checkin") < log.index("release")
    assert eng.pool.checkedout() == 0


def test_queue_timeout_answers_503_and_never_enters_the_handler(gated):
    gate, log, calls, _ = gated

    async def go():
        async with _client(gate) as c:
            first = asyncio.create_task(c.get("/api/slow"))
            await asyncio.sleep(0.05)
            second = await c.get("/api/slow")  # queue_timeout 0.15s < 0.3s
            assert second.status_code == 503
            assert second.headers["retry-after"] == "5"
            assert second.json()["detail"] == "Server is busy, please try again"
            assert (await first).status_code == 200

    asyncio.run(go())
    assert calls["slow"] == 1


def test_slots_fully_restored_after_a_storm_of_timeouts_and_cancellations():
    async def slow_app(scope, receive, send):
        await asyncio.sleep(0.02)
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})

    gate = ApiConcurrencyLimit(slow_app, limit=3, queue_timeout=0.03)

    async def one(path="/api/x"):
        sent = []

        async def send(m):
            sent.append(m)

        async def receive():
            return {"type": "http.request", "body": b""}

        await gate({"type": "http", "path": path, "method": "GET", "headers": []}, receive, send)
        return sent[0]["status"]

    async def storm():
        tasks = [asyncio.create_task(one()) for _ in range(200)]
        await asyncio.sleep(0.01)
        for t in tasks[::7]:
            t.cancel()  # some while queued, some while admitted
        results = await asyncio.gather(*tasks, return_exceptions=True)
        statuses = {r for r in results if not isinstance(r, BaseException)}
        assert statuses <= {200, 503} and 503 in statuses
        assert gate.stats() == {"limit": 3, "in_use": 0, "waiting": 0}
        # Fully usable afterwards.
        assert await asyncio.gather(*(one() for _ in range(3))) == [200, 200, 200]

    asyncio.run(storm())


def test_health_and_preflight_are_never_queued():
    started = []

    async def blocking_app(scope, receive, send):
        started.append(scope["path"])
        await asyncio.sleep(0.2)
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})

    gate = ApiConcurrencyLimit(blocking_app, limit=0, queue_timeout=0.05)

    async def call(path, method="GET"):
        sent = []

        async def send(m):
            sent.append(m)

        async def receive():
            return {"type": "http.request", "body": b""}

        await gate({"type": "http", "path": path, "method": method, "headers": []}, receive, send)
        return sent[0]["status"]

    async def go():
        assert await call("/api/x") == 503  # no slots at all
        assert await call("/api/health") == 200
        assert await call("/api/x", "OPTIONS") == 200
        assert await call("/uploads/logo.png") == 200

    asyncio.run(go())
    assert "/api/x" in started  # only the OPTIONS one reached the app


def test_overload_503_from_the_real_app_carries_cors_headers(client):
    gate = _gate_in(app)
    origin = settings.cors_origins_list[0]
    saved = (gate.limit, gate.queue_timeout, dict(gate._semaphores))
    gate.limit, gate.queue_timeout = 0, 0.05  # every API request overflows
    gate._semaphores.clear()
    try:
        r = client.get("/api/metadata/localization", headers={"Origin": origin})
        assert r.status_code == 503
        assert r.headers.get("access-control-allow-origin") == origin
        assert r.headers.get("retry-after") == "5"
        pre = client.options(
            "/api/metadata/localization",
            headers={"Origin": origin, "Access-Control-Request-Method": "GET"},
        )
        assert pre.status_code == 200
        assert pre.headers.get("access-control-allow-origin") == origin
    finally:
        gate.limit, gate.queue_timeout = saved[0], saved[1]
        gate._semaphores.clear()
        gate._semaphores.update(saved[2])


# --- pool timeout / error logging ---------------------------------------------
def test_pool_timeout_detected_directly_and_wrapped():
    assert _is_pool_timeout(sa_exc.TimeoutError("QueuePool limit"))
    try:
        try:
            raise sa_exc.TimeoutError("QueuePool limit")
        except sa_exc.TimeoutError as inner:
            raise RuntimeError("wrapped") from inner
    except RuntimeError as outer:
        assert _is_pool_timeout(outer)
    assert not _is_pool_timeout(ValueError("other"))


@app.get("/api/_test/pool-exhausted")
def _pool_exhausted():
    raise sa_exc.TimeoutError("QueuePool limit of size 10 overflow 20 reached")


def test_pool_exhausted_answers_503_without_touching_the_error_log(monkeypatch):
    from fastapi.testclient import TestClient

    calls = []
    monkeypatch.setattr(error_log, "record_error", lambda *a, **k: calls.append(a))
    r = TestClient(app, raise_server_exceptions=False).get("/api/_test/pool-exhausted")
    assert r.status_code == 503
    assert r.json()["detail"] == "Server is busy, please try again"
    assert r.headers.get("retry-after") == "5"
    assert calls == []


def test_error_log_never_waits_for_a_db_slot(monkeypatch):
    """With both error-log slots taken, record_error returns at once without
    opening a session (the error still goes to the server log)."""
    from starlette.requests import Request

    def no_session(*a, **k):
        raise AssertionError("must not open a DB session")

    monkeypatch.setattr(database, "SideSessionLocal", no_session)
    monkeypatch.delitem(app.dependency_overrides, get_db, raising=False)
    assert error_log._DB_LOG_SLOTS.acquire(blocking=False)
    assert error_log._DB_LOG_SLOTS.acquire(blocking=False)
    try:
        req = Request({"type": "http", "method": "GET", "path": "/api/x", "headers": [],
                       "query_string": b"", "app": app, "client": ("1.2.3.4", 1)})
        t = time.monotonic()
        assert error_log.record_error(req, RuntimeError("boom")) is None
        assert time.monotonic() - t < 0.5
    finally:
        error_log._DB_LOG_SLOTS.release()
        error_log._DB_LOG_SLOTS.release()


# --- login: bcrypt holds no DB connection and no worker thread -----------------
def _register(client, username, password="Passw0rd1"):
    r = client.post(
        "/api/auth/register",
        json={"username": username, "full_name": username, "password": password,
              "role": "admin", "email": f"{username}@example.com",
              "organization_name": f"org-{username}"},
    )
    assert r.status_code == 201, r.text


def test_login_checks_password_off_the_worker_pool_with_no_db_connection(client, monkeypatch):
    _register(client, "login107")
    sessions = []

    def capturing_get_db():
        db = TestingSessionLocal()
        sessions.append(db)
        try:
            yield db
        finally:
            db.close()

    seen = []

    def spy_verify(password, password_hash):
        seen.append((threading.current_thread().name, sessions[-1].in_transaction()))
        return security.verify_password(password, password_hash)

    monkeypatch.setitem(app.dependency_overrides, get_db, capturing_get_db)
    monkeypatch.setattr(auth_router, "verify_password", spy_verify)
    r = client.post("/api/auth/token", data={"username": "login107", "password": "Passw0rd1"})
    assert r.status_code == 200, r.text
    assert r.json()["access_token"]
    assert seen, "password was never checked"
    for thread_name, in_tx in seen:
        assert thread_name.startswith("bcrypt"), thread_name
        assert in_tx is False  # the connection was handed back first


def test_login_wrong_password_and_unknown_user_still_401(client):
    _register(client, "wrong107")
    r = client.post("/api/auth/token", data={"username": "wrong107", "password": "Nope12345"})
    assert r.status_code == 401
    r = client.post("/api/auth/token", data={"username": "ghost107", "password": "Nope12345"})
    assert r.status_code == 401
