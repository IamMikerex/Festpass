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


def test_dashboard_sections_match_the_database(tokens):
    d = client.get("/analytics/dashboard", headers=h(tokens["auditor"])).json()
    with db.connection() as conn:
        sold = db.fetch_one(conn, """SELECT COUNT(*) AS n FROM Tickets tk JOIN Orders o ON o.order_id = tk.order_id
                                      WHERE o.status = 'PAID' AND tk.status IN ('VALID','CHECKED_IN')""")["n"]
        quota = db.fetch_one(conn, """SELECT COALESCE(SUM(a.remaining), 0) AS n FROM v_tier_availability a
                                       JOIN Festivals f ON f.festival_id = a.festival_id WHERE f.status IN ('ON_SALE','LIVE','DRAFT')""")["n"]
        entries = db.fetch_one(conn, "SELECT COUNT(*) AS n FROM GateScans WHERE direction = 'IN' AND result = 'ACCEPTED'")["n"]
        apps = db.fetch_one(conn, "SELECT COUNT(*) AS n FROM StallAllocations")["n"]
        money = db.fetch_one(conn, """SELECT SUM(CASE WHEN payment_type='CHARGE' THEN amount ELSE -amount END) AS net
                                       FROM Payments WHERE status = 'CAPTURED'""")["net"]
    assert d["tickets"]["sold"] == sold == d["totals"]["tickets_sold"]
    assert d["tickets"]["remaining"] == int(quota)
    assert d["gate"]["entries"] == entries
    assert d["vendors"]["total_applications"] == apps
    assert abs(d["revenue"]["net"] - float(money)) < 0.01
    assert d["sales"][-1]["cumulative_tickets"] == sold  # the sales graph adds up to tickets sold
    days = [r["day"] for r in d["sales"]]
    assert days == sorted(days) and len(days) == len(set(days))  # one row per day, gaps filled


def test_dashboard_filters(tokens):
    with db.connection() as conn:
        f = db.fetch_one(conn, "SELECT festival_id FROM Festivals WHERE name = 'Bosphorus Beats'")
        sold = db.fetch_one(conn, "SELECT tickets_sold FROM v_festival_stats WHERE festival_id = %s", (f["festival_id"],))["tickets_sold"]
    fid = f["festival_id"]
    one = client.get(f"/analytics/dashboard?festival_id={fid}", headers=h(tokens["organizer"])).json()
    assert [x["festival_id"] for x in one["festivals"]] == [fid]
    assert one["tickets"]["sold"] == sold and one["filters"]["festival_id"] == fid
    # date range: only the chosen days appear in the series, and nothing is counted outside them
    r = client.get("/analytics/dashboard?from=2000-01-01&to=2000-01-03", headers=h(tokens["auditor"])).json()
    assert [x["day"] for x in r["sales"]] == ["2000-01-01", "2000-01-02", "2000-01-03"]
    assert r["tickets"]["sold"] == 0 and r["revenue"]["gross"] == 0 and r["gate"]["entries"] == 0
    # someone else's festival, a reversed range and a malformed date are refused
    assert client.get(f"/analytics/dashboard?festival_id={fid}", headers=h(tokens["organizer2"])).status_code == 403
    assert client.get("/analytics/dashboard?from=2026-02-01&to=2026-01-01", headers=h(tokens["auditor"])).status_code == 400
    assert client.get("/analytics/dashboard?from=yesterday", headers=h(tokens["auditor"])).status_code == 422
