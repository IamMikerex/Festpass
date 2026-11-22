"""
Rebuilds the `festpass` database from database/festpass.sql (drops it first!).
Understands the MySQL CLI's DELIMITER directive used by triggers and procedures.

    python -m scripts.init_db        (run from the api/ folder)
"""
import re
import sys

from app.config import settings
from app.db import connect

DELIMITER = re.compile(r"^\s*DELIMITER\s+(\S+)\s*$", re.IGNORECASE)
COMMENT_OR_BLANK = re.compile(r"^\s*(--.*)?$")


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


def main():
    script = settings.database_dir / "festpass.sql"
    batch = list(statements(script.read_text(encoding="utf-8")))
    conn = connect(database=None)
    with conn.cursor() as cur:
        print(f"Running {script.name} ({len(batch)} statements)...", end=" ", flush=True)
        for statement in batch:
            try:
                cur.execute(statement)
            except Exception:
                print(f"\nFailed statement:\n{statement[:400]}\n", file=sys.stderr)
                raise
        cur.execute("SELECT (SELECT COUNT(*) FROM festpass.Users) AS users, (SELECT COUNT(*) FROM festpass.Tickets) AS tickets")
        counts = cur.fetchone()
    conn.close()
    print(f"done\nDatabase ready: {counts['users']} users, {counts['tickets']} tickets. "
          "Demo password for every account: Password123!")


if __name__ == "__main__":
    main()
