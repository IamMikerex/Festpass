"""init_db must only ever touch the database it was pointed at (no MySQL needed)."""
from app.config import settings
from scripts import init_db


def test_every_database_statement_is_retargeted():
    sql = (settings.database_dir / "festpass.sql").read_text(encoding="utf-8")
    batch = [init_db.TARGET.sub(lambda m: m.group(1) + "festpass_test", s) for s in init_db.statements(sql)]
    named = [db for s in batch for db in init_db.NAMED.findall(s)]
    assert named and set(named) == {"festpass_test"}, named  # DROP, CREATE and USE all hit the test copy
