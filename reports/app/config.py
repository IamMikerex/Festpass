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


settings = Settings()
