"""
PyMySQL access with a small connection pool.

`db` runs each statement on its own autocommitted connection; `transaction()`
holds one connection for a unit of work and rolls back on any exception.
Rows come back as plain dicts with JSON-ready values (DECIMAL -> float,
DATE/DATETIME -> ISO strings), so the browser never sees timezone drift.
"""
import datetime as dt
import queue
import re
from contextlib import contextmanager
from decimal import Decimal

import pymysql
from pymysql.cursors import DictCursor

from .config import settings

POOL_SIZE = 15
_idle: queue.LifoQueue = queue.LifoQueue(maxsize=POOL_SIZE)
_TZ = re.sub(r"[^0-9:+-]", "", settings.db_timezone)


def connect(database=settings.db_name):
    return pymysql.connect(
        host=settings.db_host, port=settings.db_port, user=settings.db_user, password=settings.db_password,
        database=database, charset="utf8mb4", cursorclass=DictCursor, autocommit=True,
        init_command=f"SET time_zone = '{_TZ}'",
    )


@contextmanager
def _checkout():
    try:
        conn = _idle.get_nowait()
        conn.ping(reconnect=True)
    except queue.Empty:
        conn = connect()
    try:
        yield conn
    except (pymysql.err.OperationalError, pymysql.err.InterfaceError):
        conn.close()  # broken link: never hand it out again
        raise
    finally:
        if conn.open:
            try:
                _idle.put_nowait(conn)
            except queue.Full:
                conn.close()


def _clean(value):
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, dt.datetime):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    if isinstance(value, dt.date):
        return value.isoformat()
    if isinstance(value, dt.timedelta):
        return str(value)
    return value


class Session:
    def __init__(self, conn=None):
        self._conn = conn

    @contextmanager
    def _cursor(self):
        if self._conn:
            with self._conn.cursor() as cur:
                yield cur
        else:
            with _checkout() as conn, conn.cursor() as cur:
                yield cur

    def fetch_all(self, sql, params=()):
        with self._cursor() as cur:
            cur.execute(sql, params)
            return [{k: _clean(v) for k, v in row.items()} for row in cur.fetchall()]

    def fetch_one(self, sql, params=()):
        rows = self.fetch_all(sql, params)
        return rows[0] if rows else None

    def scalar(self, sql, params=()):
        row = self.fetch_one(sql, params)
        return next(iter(row.values())) if row else None

    def execute(self, sql, params=()):
        """Runs a write and returns the number of affected rows."""
        with self._cursor() as cur:
            return cur.execute(sql, params)

    def insert(self, sql, params=()):
        """Runs an INSERT and returns the new AUTO_INCREMENT id."""
        with self._cursor() as cur:
            cur.execute(sql, params)
            return cur.lastrowid


db = Session()


@contextmanager
def transaction():
    with _checkout() as conn:
        conn.begin()
        try:
            yield Session(conn)
        except BaseException:
            conn.rollback()
            raise
        conn.commit()


@contextmanager
def snapshot():
    """Read-only transaction: every query of one report sees the same data."""
    with _checkout() as conn:
        conn.query("START TRANSACTION READ ONLY")
        try:
            yield Session(conn)
        finally:
            conn.commit()
