"""Runtime settings, read from api/.env and the process environment."""
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")


def _env(name, default=None):
    value = os.getenv(name, default)
    if value is None:
        raise RuntimeError(f"Missing environment variable {name}")
    return value


class Settings:
    env = os.getenv("APP_ENV", "development")
    db_host = _env("DB_HOST", "127.0.0.1")
    db_port = int(_env("DB_PORT", "3306"))
    db_user = _env("DB_USER", "festpass")
    db_password = _env("DB_PASSWORD", "festpass")
    db_name = _env("DB_NAME", "festpass")
    db_timezone = _env("DB_TIMEZONE", "+03:00")
    jwt_secret = _env("JWT_SECRET", None if env == "production" else "dev-only-change-me")
    jwt_hours = int(_env("JWT_EXPIRES_HOURS", "8"))
    webhook_secret = _env("PAYMENT_WEBHOOK_SECRET", "dev-webhook-secret")
    cors_origin = [o.strip() for o in _env("CORS_ORIGIN", "http://localhost:5173").split(",")]
    jobs_interval = int(_env("JOBS_INTERVAL_SECONDS", "30"))
    client_dist = ROOT.parent / "client" / "dist"
    database_dir = ROOT.parent / "database"


settings = Settings()
