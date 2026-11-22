"""Settings for the FestPass analytics service. Reads reports/.env, then falls back to server/.env."""
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")
load_dotenv(ROOT.parent / "server" / ".env")  # does not override values already set


class Settings:
    db_host = os.getenv("DB_HOST", "127.0.0.1")
    db_port = int(os.getenv("DB_PORT", "3306"))
    db_user = os.getenv("DB_USER", "festpass")
    db_password = os.getenv("DB_PASSWORD", "festpass")
    db_name = os.getenv("DB_NAME", "festpass")
    db_timezone = os.getenv("DB_TIMEZONE", "+03:00")
    jwt_secret = os.getenv("JWT_SECRET", "dev-only-change-me")
    cors_origin = [o.strip() for o in os.getenv("CORS_ORIGIN", "http://localhost:5173").split(",")]
    env = os.getenv("APP_ENV", os.getenv("NODE_ENV", "development"))
    log_json = os.getenv("LOG_FORMAT", "json" if env == "production" else "text") == "json"
    log_level = os.getenv("LOG_LEVEL", "INFO").upper()
    docs_enabled = os.getenv("ANALYTICS_DOCS", "true") != "false"


settings = Settings()

def validate():
    """Exit with a clear message when production runs with development secrets."""
    if settings.env != "production":
        return
    secret = settings.jwt_secret.lower()
    if len(secret) < 32 or "change-me" in secret or "dev-only" in secret:
        raise SystemExit("Invalid production configuration: JWT_SECRET must be the same long random secret as the Express API")
