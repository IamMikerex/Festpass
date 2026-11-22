"""FestPass analytics service. Run: uvicorn app.main:app --port 8000"""
import time
import uuid

import pymysql
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import db
from .config import settings
from .logging_setup import setup
from .reports import router

log = setup()

app = FastAPI(
    title="FestPass Analytics API",
    version="1.0.0",
    description="Read-only reporting service for FestPass (dashboards, reports, ledgers, CSV exports). "
                "Authenticate with the JWT issued by the Express API: `Authorization: Bearer <token>`.",
    docs_url="/analytics/docs" if settings.docs_enabled else None,
    redoc_url=None,
    openapi_url="/analytics/openapi.json" if settings.docs_enabled else None,
)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origin, allow_methods=["GET"], allow_headers=["Authorization"])


@app.middleware("http")
async def request_context(request: Request, call_next):
    """Request id (kept from the Express proxy) and one access-log line per request."""
    rid = request.headers.get("x-request-id") or str(uuid.uuid4())
    request.state.request_id = rid
    start = time.perf_counter()
    response = await call_next(request)
    response.headers["X-Request-Id"] = rid
    if request.url.path != "/analytics/health":
        fields = {"request_id": rid, "method": request.method, "path": request.url.path,
                  "status": response.status_code, "ms": round((time.perf_counter() - start) * 1000)}
        (log.error if response.status_code >= 500 else log.info)("request", extra={"fields": fields})
    return response


def _rid(request: Request):
    return getattr(request.state, "request_id", None)


@app.exception_handler(pymysql.err.OperationalError)
async def db_unavailable(request: Request, exc):
    log.error("Database unavailable", exc_info=exc, extra={"fields": {"request_id": _rid(request)}})
    return JSONResponse(status_code=503, content={"detail": "The analytics service cannot reach the database right now", "request_id": _rid(request)})


@app.exception_handler(Exception)
async def unhandled(request: Request, exc):
    log.error("Unhandled error", exc_info=exc, extra={"fields": {"request_id": _rid(request), "path": request.url.path}})
    return JSONResponse(status_code=500, content={"detail": "Something went wrong on our side", "request_id": _rid(request)})


@app.get("/analytics/health")
def health():
    try:
        with db.connection() as conn:
            row = db.fetch_one(conn, "SELECT NOW() AS db_time, VERSION() AS version")
    except Exception as exc:  # noqa: BLE001 - any failure means not ready
        log.error("Health check: database unreachable", exc_info=exc)
        return JSONResponse(status_code=503, content={"ok": False, "error": "Database unreachable"})
    return {"ok": True, "service": "festpass-analytics", **row}


app.include_router(router)
