"""Thin PyMySQL helper. The analytics service is read-only: it never writes to the database."""
import datetime as dt
import re
from contextlib import contextmanager
from decimal import Decimal

import pymysql
from pymysql.cursors import DictCursor

from .config import settings


def _clean(value):
    # Same wire format as the Express API (mysql2 dateStrings): no timezone drift in the browser.
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, dt.datetime):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(value, dt.date):
        return value.isoformat()
    if isinstance(value, dt.timedelta):
        return str(value)
    return value


@contextmanager
def connection():
    tz = re.sub(r"[^0-9:+-]", "", settings.db_timezone)
    conn = pymysql.connect(
        host=settings.db_host, port=settings.db_port, user=settings.db_user,
        password=settings.db_password, database=settings.db_name,
        cursorclass=DictCursor, charset="utf8mb4", autocommit=True,
        init_command=f"SET time_zone = '{tz}'",
    )
    try:
        # A consistent snapshot for every query of one report.
        with conn.cursor() as cur:
            cur.execute("START TRANSACTION READ ONLY")
        yield conn
        conn.commit()
    finally:
        conn.close()


def fetch_all(conn, sql, params=()):
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return [{k: _clean(v) for k, v in row.items()} for row in cur.fetchall()]


def fetch_one(conn, sql, params=()):
    rows = fetch_all(conn, sql, params)
    return rows[0] if rows else None
