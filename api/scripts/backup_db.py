"""
Dumps the FestPass MySQL database (tables, data, triggers, views, routines) to api/data/backups/.

    python -m scripts.backup_db                 (run from api/; uses `docker exec festpass-mysql` when that container runs)

Restore (overwrites that database, so be sure):
    docker exec -i festpass-mysql mysql -ufestpass -p<password> festpass < data/backups/<file>.sql
"""
import os
import shutil
import subprocess
import sys
from datetime import datetime

from app.config import settings

CONTAINER = os.getenv("MYSQL_CONTAINER", "festpass-mysql")


def main():
    out_dir = settings.data_dir / "backups"
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / f"{settings.db_name}-{datetime.now():%Y%m%d-%H%M%S}.sql"
    dump = ["mysqldump", f"-u{settings.db_user}", "--single-transaction", "--routines", "--triggers", "--events",
            "--no-tablespaces", "--set-gtid-purged=OFF", settings.db_name]
    running = shutil.which("docker") and subprocess.run(["docker", "ps", "-q", "-f", f"name=^{CONTAINER}$"], capture_output=True, text=True, check=False).stdout.strip()
    # The password travels in MYSQL_PWD, never on the command line.
    cmd = ["docker", "exec", "-e", "MYSQL_PWD", CONTAINER, *dump] if running else [*dump[:1], f"-h{settings.db_host}", f"-P{settings.db_port}", *dump[1:]]
    with open(target, "wb") as f:
        result = subprocess.run(cmd, stdout=f, stderr=subprocess.PIPE, check=False, env={**os.environ, "MYSQL_PWD": settings.db_password})
    if result.returncode or target.stat().st_size == 0:
        target.unlink(missing_ok=True)
        sys.exit(f"Backup failed: {result.stderr.decode(errors='replace').strip()}")
    print(f"Backup written: {target} ({target.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
