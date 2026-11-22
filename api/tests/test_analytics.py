"""Analytics endpoints: scoping by role, reports, CSV exports and the rule 13 reconciliation."""
from app.db import db


def festival_id(name):
    return db.scalar("SELECT festival_id FROM Festivals WHERE name = %s", (name,))


def test_health(api):
    assert api("GET", "/api/health").data["ok"] is True


def test_requires_auth_and_staff_role(api, tokens):
    assert api("GET", "/analytics/dashboard").status_code == 401
    assert api("GET", "/analytics/dashboard", "garbage").status_code == 401
    assert api("GET", "/analytics/dashboard", tokens["ayse"]).status_code == 403
    assert api("GET", "/analytics/dashboard", tokens["gate"]).status_code == 403


def test_dashboard_scoping(api, tokens):
    org, org2, aud = (api("GET", "/analytics/dashboard", tokens[u]).data for u in ("organizer", "organizer2", "auditor"))
    assert org["totals"]["tickets_sold"] > 0
    assert aud["totals"]["festivals"] >= org["totals"]["festivals"] + org2["totals"]["festivals"]
    assert len({f["organizer_id"] for f in org2["festivals"]}) == 1


def test_festival_report_and_forbidden(api, tokens):
    url = f"/analytics/festivals/{festival_id('Bosphorus Beats')}/report"
    r = api("GET", url, tokens["organizer"])
    assert r.status_code == 200 and r.data["inside_now"] >= 0 and r.data["tiers"]
    assert api("GET", url, tokens["organizer2"]).status_code == 403


def test_csv_exports(api, tokens):
    r = api("GET", "/analytics/payments?format=csv", tokens["auditor"])
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    assert r.text.startswith("payment_id,")
    assert api("GET", "/analytics/scans?format=csv&result=ACCEPTED", tokens["auditor"]).text.startswith("scan_id,")


def test_reconciliation_rule_13(api, tokens):
    r = api("GET", "/analytics/reconciliation", tokens["auditor"]).data
    assert not [i for i in r["issues"] if i["verdict"] == "OVER_REFUNDED"]
    assert r["summary"]["refunded"] <= r["summary"]["captured"]


def test_ticket_trail(api, tokens):
    ticket_id = db.scalar("SELECT ticket_id FROM TicketTransfers LIMIT 1")
    r = api("GET", f"/analytics/tickets/{ticket_id}/trail", tokens["auditor"]).data
    assert r["transfers"] and r["ticket"]["buyer_name"]
