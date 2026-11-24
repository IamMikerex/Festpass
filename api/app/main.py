"""FestPass API. Run from api/: `fastapi dev` (docs at /docs and /redoc)."""
import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse

from . import errors, jobs
from .config import settings
from .db import db
from .errors import NotFound
from .models import create_sqlite_tables
from .routers import admin, analytics, auth, catalog, festivals, lineup, orders, payments, scans, tickets, vendors

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
}


@asynccontextmanager
async def lifespan(_: FastAPI):
    create_sqlite_tables()
    task = asyncio.create_task(jobs.run_forever()) if settings.jobs_interval > 0 else None
    yield
    if not task:
        return
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await task


app = FastAPI(
    title="FestPass API",
    version="2.0.0",
    description="Music festival ticketing and vendor management. Sign in at `POST /api/auth/login`, "
                "then send `Authorization: Bearer <token>`.",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origin, allow_methods=["*"],
                   allow_headers=["Authorization", "Content-Type"])
errors.install(app)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.update(SECURITY_HEADERS)
    return response


@app.get("/api", tags=["meta"])
async def read_root():
    return {"Hello": "World", "app": "FestPass API", "docs": "/docs", "redoc": "/redoc"}


@app.get("/api/docs", include_in_schema=False)
def old_docs():
    return RedirectResponse("/docs")


@app.get("/api/health", tags=["meta"])
def health():
    return {"ok": True, **db.fetch_one("SELECT NOW() AS db_time, VERSION() AS version")}


for module in (auth, festivals, orders, tickets, scans, vendors, payments, admin, analytics, catalog, lineup):
    app.include_router(module.router)
app.include_router(vendors.allocations)


@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"], include_in_schema=False)
def client(path: str, request: Request):
    """Serves the built React app (client/dist) with history-API fallback; unknown API paths stay JSON 404s."""
    dist = settings.client_dist
    if request.method != "GET" or path.startswith(("api/", "analytics/")) or not dist.is_dir():
        raise NotFound("Endpoint not found")
    file = (dist / path).resolve()
    if path and file.is_file() and file.is_relative_to(dist.resolve()):
        return FileResponse(file)
    return FileResponse(dist / "index.html")
