"""FestPass analytics service. Run: uvicorn app.main:app --port 8000"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import db
from .config import settings
from .reports import router

app = FastAPI(
    title="FestPass Analytics API",
    version="1.0.0",
    description="Read-only reporting service for FestPass (dashboards, reports, ledgers, CSV exports). "
                "Authenticate with the JWT issued by the Express API: `Authorization: Bearer <token>`.",
    docs_url="/analytics/docs",
    openapi_url="/analytics/openapi.json",
)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origin, allow_methods=["GET"], allow_headers=["Authorization"])


@app.get("/analytics/health")
def health():
    with db.connection() as conn:
        row = db.fetch_one(conn, "SELECT NOW() AS db_time, VERSION() AS version")
    return {"ok": True, "service": "festpass-analytics", **row}


app.include_router(router)
