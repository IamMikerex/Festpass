"""
Tests for the FastAPI analytics service. Needs the seeded database and uses tokens
signed with the shared JWT secret (the same way the Express API signs them).
    cd reports && .venv/bin/pytest -q
"""
import time

import jwt
import pytest
from fastapi.testclient import TestClient

from app import db
from app.config import settings
from app.main import app

client = TestClient(app)


def token_for(email):
    with db.connection() as conn:
        u = db.fetch_one(conn, "SELECT user_id, role FROM Users WHERE email = %s", (email,))
    return jwt.encode({"sub": str(u["user_id"]), "role": u["role"], "exp": int(time.time()) + 600}, settings.jwt_secret, algorithm="HS256")


@pytest.fixture(scope="module")
def tokens():
    return {k: token_for(f"{k}@festpass.com") for k in ["organizer", "organizer2", "auditor", "ayse", "gate"]}


def h(tok):
    return {"Authorization": f"Bearer {tok}"}


def test_health():
    assert client.get("/analytics/health").json()["ok"] is True


def test_requires_auth_and_staff_role(tokens):
    assert client.get("/analytics/dashboard").status_code == 401
    assert client.get("/analytics/dashboard", headers=h("garbage")).status_code == 401
    assert client.get("/analytics/dashboard", headers=h(tokens["ayse"])).status_code == 403
    assert client.get("/analytics/dashboard", headers=h(tokens["gate"])).status_code == 403


def test_dashboard_scoping(tokens):
    org = client.get("/analytics/dashboard", headers=h(tokens["organizer"])).json()
    aud = client.get("/analytics/dashboard", headers=h(tokens["auditor"])).json()
    org2 = client.get("/analytics/dashboard", headers=h(tokens["organizer2"])).json()
    assert org["totals"]["tickets_sold"] > 0
    assert aud["totals"]["festivals"] >= org["totals"]["festivals"] + org2["totals"]["festivals"] - 0
    assert all(f["organizer_id"] == org2["festivals"][0]["organizer_id"] for f in org2["festivals"])


def test_festival_report_and_forbidden(tokens):
    with db.connection() as conn:
        f = db.fetch_one(conn, "SELECT festival_id FROM Festivals WHERE name = 'Bosphorus Beats'")
    r = client.get(f"/analytics/festivals/{f['festival_id']}/report", headers=h(tokens["organizer"]))
    assert r.status_code == 200
    body = r.json()
    assert body["inside_now"] >= 0 and body["tiers"]
    assert client.get(f"/analytics/festivals/{f['festival_id']}/report", headers=h(tokens["organizer2"])).status_code == 403


def test_csv_exports(tokens):
    r = client.get("/analytics/payments?format=csv", headers=h(tokens["auditor"]))
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert r.text.startswith("payment_id,")
    r = client.get("/analytics/scans?format=csv&result=ACCEPTED", headers=h(tokens["auditor"]))
    assert r.text.startswith("scan_id,")


def test_reconciliation_rule_13(tokens):
    r = client.get("/analytics/reconciliation", headers=h(tokens["auditor"])).json()
    assert not [i for i in r["issues"] if i["verdict"] == "OVER_REFUNDED"]
    assert r["summary"]["refunded"] <= r["summary"]["captured"]


def test_ticket_trail(tokens):
    with db.connection() as conn:
        t = db.fetch_one(conn, "SELECT ticket_id FROM TicketTransfers LIMIT 1")
    r = client.get(f"/analytics/tickets/{t['ticket_id']}/trail", headers=h(tokens["auditor"])).json()
    assert r["transfers"] and r["ticket"]["buyer_name"]
