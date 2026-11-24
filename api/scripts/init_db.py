"""
Builds the FestPass MySQL database (DB_NAME, default `festpass`) from database/festpass.sql.
Understands the MySQL CLI's DELIMITER directive used by triggers and procedures.

    python -m scripts.init_db             create it; refuses if the database already has data
    python -m scripts.init_db --if-empty  same, but exits quietly when data exists (used on deploy)
    python -m scripts.init_db --reset     DROP and rebuild (local only; refused when APP_ENV=production)

Back up first with `python -m scripts.backup_db`.
"""
import re
import sys

from app.config import settings
from app.db import connect

DELIMITER = re.compile(r"^\s*DELIMITER\s+(\S+)\s*$", re.IGNORECASE)
COMMENT_OR_BLANK = re.compile(r"^\s*(--.*)?$")
# The script names `festpass`; these statements are retargeted to DB_NAME (tests use a separate database).
TARGET = re.compile(r"^((?:DROP|CREATE) DATABASE (?:IF EXISTS )?|USE )festpass\b", re.IGNORECASE | re.MULTILINE)
NAMED = re.compile(r"^\s*(?:(?:DROP|CREATE) DATABASE (?:IF EXISTS )?|USE )`?(\w+)", re.IGNORECASE | re.MULTILINE)


def statements(sql: str):
    delimiter, buffer = ";", []
    for line in sql.splitlines():
        if match := DELIMITER.match(line):
            delimiter = match.group(1)
            continue
        buffer.append(line)
        if line.rstrip().endswith(delimiter):
            statement = "\n".join(buffer).rstrip()[: -len(delimiter)].strip()
            buffer = []
            if not all(COMMENT_OR_BLANK.match(text) for text in statement.splitlines()):
                yield statement
    if "".join(buffer).strip():
        yield "\n".join(buffer).strip()


def has_data(cur, name):
    return cur.execute("SELECT 1 FROM information_schema.tables WHERE table_schema = %s AND table_name = 'Users'", (name,))


def main(reset=False, if_empty=False):
    name = settings.db_name
    if not re.fullmatch(r"\w+", name):
        sys.exit(f"Refusing: unexpected DB_NAME {name!r}")
    if reset and settings.env == "production":
        sys.exit("Refusing to --reset while APP_ENV=production. Production data is never dropped by this script.")
    script = settings.database_dir / "festpass.sql"
    batch = [TARGET.sub(lambda m: m.group(1) + name, s) for s in statements(script.read_text(encoding="utf-8"))]
    # Safety net: never run a statement that drops, creates or switches to any database other than the target.
    if stray := [s for s in batch if any(db != name for db in NAMED.findall(s))]:
        sys.exit(f"Refusing: a statement targets another database than `{name}`:\n{stray[0][:300]}")
    conn = connect(database=None)
    with conn.cursor() as cur:
        if has_data(cur, name) and not reset:
            conn.close()
            if if_empty:
                return print(f"Database `{name}` already initialised; skipping.")
            sys.exit(f"Database `{name}` already has data, so nothing was changed.\n"
                     "To wipe it and reload the demo data run `python -m scripts.init_db --reset` (back up first).")
        print(f"Building `{name}` from {script.name} ({len(batch)} statements)...", end=" ", flush=True)
        for statement in batch:
            try:
                cur.execute(statement)
            except Exception:
                print(f"\nFailed statement:\n{statement[:400]}\n", file=sys.stderr)
                raise
        cur.execute(f"SELECT (SELECT COUNT(*) FROM `{name}`.Users) AS users, (SELECT COUNT(*) FROM `{name}`.Tickets) AS tickets")
        counts = cur.fetchone()
    conn.close()
    print(f"done\nDatabase ready: {counts['users']} users, {counts['tickets']} tickets. "
          "Demo password for every account: Password123!")


if __name__ == "__main__":
    main(reset="--reset" in sys.argv, if_empty="--if-empty" in sys.argv)
