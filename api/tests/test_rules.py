"""Business rules 1-13 against the live API and a real MySQL database (tests run in file order)."""
from concurrent.futures import ThreadPoolExecutor

import pymysql
import pytest

from app import jobs
from app.config import settings
from app.db import db

CARD_OK, CARD_DECLINED = "4111111111111111", "4111111111110002"


@pytest.fixture
def tier(api):
    return lambda festival_id, name: next(t for t in api("GET", f"/api/festivals/{festival_id}").data["tiers"]
                                          if t["tier_name"] == name)


@pytest.fixture
def buy(api):
    def buy(token, festival_id, tier_id, quantity=1, **extra):
        return api("POST", "/api/orders", token, {"festival_id": festival_id,
                                                  "items": [{"tier_id": tier_id, "quantity": quantity, **extra}]})
    return buy


def my_ticket(api, token, **match):
    return next(t for t in api("GET", "/api/tickets", token).data["tickets"]
                if all(t[k] == v for k, v in match.items()))


def qr_of(api, token, ticket_id):
    return api("GET", f"/api/tickets/{ticket_id}", token).data["ticket"]["qr_token"]


def test_auth(api, tokens):
    fan = {"email": "new.fan@example.com", "password": "Secret123", "full_name": "New Fan", "date_of_birth": "2000-05-05"}
    r = api("POST", "/api/auth/register", body=fan)
    assert r.status_code == 201 and r.data["user"]["role"] == "ATTENDEE"
    assert api("POST", "/api/auth/register", body={**fan, "full_name": "X Y"}).status_code == 409
    assert api("POST", "/api/auth/register", body={**fan, "email": "boss@example.com", "role": "ORGANIZER"}).status_code == 400
    assert api("POST", "/api/auth/login", body={"email": "ayse@festpass.com", "password": "nope"}).status_code == 401
    assert api("GET", "/api/admin/users", tokens["ayse"]).status_code == 403


def test_rules_1_to_3_checkout(api, tokens, tier, buy):
    vip, general = tier(1, "VIP"), tier(1, "General")
    assert buy(tokens["can"], 1, vip["tier_id"], 5).status_code == 409, "VIP max_per_order is 4"
    r = buy(tokens["can"], 1, general["tier_id"], 6)
    assert r.status_code == 201 and r.data["order"]["status"] == "PENDING"
    assert 590 < r.data["order"]["seconds_left"] <= 600, "rule 3: 10 minute hold"
    first = r.data["order"]["order_id"]
    assert buy(tokens["can"], 1, general["tier_id"], 5).status_code == 409, "rule 1: 6 pending + 5 > 10"

    pay = lambda card: api("POST", f"/api/orders/{first}/pay", tokens["can"], {"method": "CARD", "card_number": card})  # noqa: E731
    assert pay(CARD_DECLINED).status_code == 402
    r = pay(CARD_OK)
    assert r.status_code == 200 and r.data["order"]["status"] == "PAID"
    assert sum(p["status"] == "FAILED" for p in r.data["order"]["payments"]) == 1

    second = buy(tokens["can"], 1, general["tier_id"], 2).data["order"]["order_id"]
    assert api("POST", f"/api/orders/{second}/cancel", tokens["can"]).status_code == 200
    order = api("GET", f"/api/orders/{second}", tokens["can"]).data["order"]
    assert order["status"] == "CANCELLED" and all(t["status"] == "VOID" for t in order["tickets"])


def test_rule_3_expired_hold(api, tokens, tier, buy):
    order_id = buy(tokens["elif"], 3, tier(3, "General")["tier_id"], 2).data["order"]["order_id"]
    db.execute("UPDATE Orders SET created_at = NOW() - INTERVAL 20 MINUTE, expires_at = NOW() - INTERVAL 10 MINUTE "
               "WHERE order_id = %s", (order_id,))
    assert api("POST", f"/api/orders/{order_id}/pay", tokens["elif"], {"method": "WALLET"}).status_code == 410
    order = api("GET", f"/api/orders/{order_id}", tokens["elif"]).data["order"]
    assert order["status"] == "EXPIRED" and all(t["status"] == "VOID" for t in order["tickets"])


def test_rule_2_hard_quota(api, tokens, tier, buy):
    backstage = tier(3, "Backstage")
    db.execute("UPDATE TicketTiers SET quota = %s WHERE tier_id = %s", (backstage["sold"] + 1, backstage["tier_id"]))
    r = buy(tokens["elif"], 3, backstage["tier_id"], 2)
    assert r.status_code == 409 and "Only 1" in r.data["error"]
    assert buy(tokens["elif"], 3, backstage["tier_id"]).status_code == 201
    r = buy(tokens["can"], 3, backstage["tier_id"])
    assert r.status_code == 409 and "sold out" in r.data["error"]


def test_rule_2_no_oversell_under_concurrency(api, tokens, tier, buy):
    sunset = tier(4, "Sunset Pass")
    db.execute("UPDATE TicketTiers SET quota = %s WHERE tier_id = %s", (sunset["sold"] + 1, sunset["tier_id"]))
    buyers = [tokens[u] for u in ("ayse", "can", "organizer2")] + [api.login(f"fan{i}@example.com") for i in range(1, 6)]
    with ThreadPoolExecutor(len(buyers)) as pool:
        results = list(pool.map(lambda t: buy(t, 4, sunset["tier_id"]), buyers))
    assert sum(r.status_code == 201 for r in results) == 1, "exactly one buyer wins"
    assert tier(4, "Sunset Pass")["remaining"] == 0


def test_rule_4_minimum_age(api, tokens, tier, buy):
    general = tier(1, "General")["tier_id"]
    assert buy(tokens["deniz"], 1, general).status_code == 409
    r = buy(tokens["ayse"], 1, general, holder_emails=["deniz@festpass.com"])
    assert r.status_code == 409 and "rule 4" in r.data["error"]


def test_rule_5_single_transfer(api, tokens):
    ticket = my_ticket(api, tokens["ayse"], festival_name="Istanbul Sound Festival", status="VALID")
    old_qr = qr_of(api, tokens["ayse"], ticket["ticket_id"])
    transfer = lambda token, email, tid=ticket["ticket_id"]: api(  # noqa: E731
        "POST", f"/api/tickets/{tid}/transfer", token, {"email": email})

    assert transfer(tokens["ayse"], "deniz@festpass.com").status_code == 409, "minor recipient"
    assert transfer(tokens["ayse"], "can@festpass.com").status_code == 200
    assert qr_of(api, tokens["can"], ticket["ticket_id"]) != old_qr, "new holder gets a fresh QR"
    assert transfer(tokens["can"], "elif@festpass.com").status_code == 409, "second transfer blocked"
    scan = api("POST", "/api/scans", tokens["gate"], {"qr_token": old_qr, "gate_code": "N-1", "direction": "IN"})
    assert scan.data["result"] == "REJECTED_INVALID", "old QR admits nobody"

    live = my_ticket(api, tokens["ayse"], festival_name="Bosphorus Beats")
    r = transfer(tokens["ayse"], "elif@festpass.com", live["ticket_id"])
    assert r.status_code == 409 and "48 hours" in r.data["error"]


@pytest.mark.parametrize("festival_id, tier_name, rate, amount", [(1, "General", 0.9, 1665), (3, "General", 0.5, 475)])
def test_rule_6_refund_bands(api, tokens, tier, buy, festival_id, tier_name, rate, amount):
    order = buy(tokens["elif"], festival_id, tier(festival_id, tier_name)["tier_id"]).data["order"]
    api("POST", f"/api/orders/{order['order_id']}/pay", tokens["elif"], {"method": "WALLET"})
    ticket = my_ticket(api, tokens["elif"], order_id=order["order_id"])
    r = api("POST", f"/api/tickets/{ticket['ticket_id']}/refund", tokens["elif"])
    assert r.status_code == 200 and (r.data["rate"], r.data["amount"]) == (rate, amount)


def test_rule_6_no_refund_inside_seven_days(api, tokens):
    ticket = my_ticket(api, tokens["elif"], festival_name="Antalya Sunset Sessions")
    r = api("POST", f"/api/tickets/{ticket['ticket_id']}/refund", tokens["elif"])
    assert r.status_code == 409 and "less than 7 days" in r.data["error"]


def test_rule_8_anti_passback(api, tokens):
    ticket = my_ticket(api, tokens["can"], festival_name="Bosphorus Beats")
    qr = qr_of(api, tokens["can"], ticket["ticket_id"])

    def scan(direction, gate="NORTH-1", token=tokens["gate"], code=qr):
        return api("POST", "/api/scans", token, {"qr_token": code, "gate_code": gate, "direction": direction})

    assert scan("OUT").data["result"] == "REJECTED_INVALID"
    assert scan("IN").data["result"] == "ACCEPTED"
    assert scan("IN", "SOUTH-1").data["result"] == "REJECTED_DUPLICATE"
    assert scan("OUT").data["result"] == "ACCEPTED"
    with ThreadPoolExecutor(2) as pool:
        both = list(pool.map(lambda gate: scan("IN", gate).data["result"], ["NORTH-1", "NORTH-2"]))
    assert sorted(both) == ["ACCEPTED", "REJECTED_DUPLICATE"], "same QR at two gates at once"
    assert api("POST", f"/api/tickets/{ticket['ticket_id']}/refund", tokens["ayse"]).status_code in (403, 409)

    upcoming = my_ticket(api, tokens["can"], festival_name="Istanbul Sound Festival", status="VALID")
    upcoming_qr = qr_of(api, tokens["can"], upcoming["ticket_id"])
    assert scan("IN", code=upcoming_qr).data["result"] == "REJECTED_NOT_LIVE"
    assert scan("IN", token=tokens["ayse"], code=upcoming_qr).status_code == 403


def test_rules_9_to_11_vendor_lifecycle(api, tokens):
    stalls = api("GET", "/api/festivals/1/stalls", tokens["vendor2"]).data["stalls"]
    free = [s for s in stalls if not s["approved_vendor"]]
    vendors = api("GET", "/api/vendors/mine", tokens["vendor2"]).data["vendors"]
    by = lambda **kv: next(v for v in vendors if all(v[k] == x for k, x in kv.items()))  # noqa: E731
    apply = lambda vendor, stall: api("POST", "/api/allocations", tokens["vendor2"],  # noqa: E731
                                      {"vendor_id": vendor["vendor_id"], "stall_id": stall["stall_id"]})

    r = apply(by(tax_number="4567890123"), free[0])
    assert r.status_code == 409 and "rule 9" in r.data["error"], "hygiene certificate expires before the festival"
    assert apply(by(status="PENDING_REVIEW"), free[0]).status_code == 409
    merch = by(category="MERCH")
    assert apply(merch, next(s for s in stalls if s["approved_vendor"])).status_code == 409, "stall already taken"

    ids = []
    for stall in [s for s in free if s["open_applications"] == 0][:3]:
        r = apply(merch, stall)
        assert r.status_code == 201
        ids.append(r.data["allocation"]["allocation_id"])
    approve = lambda aid, token, body=None: api("POST", f"/api/allocations/{aid}/approve", token, body or {})  # noqa: E731
    assert approve(ids[0], tokens["organizer2"]).status_code == 403, "not their festival"
    assert approve(ids[0], tokens["organizer"], {"agreed_fee": 10000}).status_code == 200
    assert approve(ids[1], tokens["organizer"]).status_code == 200
    assert approve(ids[2], tokens["organizer"]).status_code == 409, "rule 10: at most 2 stalls"

    r = api("POST", f"/api/allocations/{ids[0]}/pay", tokens["vendor2"], {"method": "BANK_TRANSFER"})
    assert r.status_code == 200 and r.data["amount"] == 10000
    assert api("POST", f"/api/allocations/{ids[0]}/cancel", tokens["vendor2"]).data["refund"] == 10000

    db.execute("UPDATE StallAllocations SET approved_at = NOW() - INTERVAL 8 DAY WHERE allocation_id = %s", (ids[1],))
    jobs.run_once()
    assert db.scalar("SELECT status FROM StallAllocations WHERE allocation_id = %s", (ids[1],)) == "CANCELLED"


def test_rule_11_late_vendor_cancellation(api, tokens):
    stall = next(s for s in api("GET", "/api/festivals/3/stalls", tokens["vendor"]).data["stalls"]
                 if not s["approved_vendor"] and s["stall_code"] == "E-01")
    vendor = next(v for v in api("GET", "/api/vendors/mine", tokens["vendor"]).data["vendors"] if v["category"] == "BEVERAGE")
    aid = api("POST", "/api/allocations", tokens["vendor"],
              {"vendor_id": vendor["vendor_id"], "stall_id": stall["stall_id"]}).data["allocation"]["allocation_id"]
    api("POST", f"/api/allocations/{aid}/approve", tokens["organizer"], {})
    api("POST", f"/api/allocations/{aid}/pay", tokens["vendor"], {"method": "CARD", "card_number": "5555444433331111"})
    r = api("POST", f"/api/allocations/{aid}/cancel", tokens["vendor"])
    assert (r.data["rate"], r.data["refund"]) == (0.5, 3250)


def test_rule_12_state_machine_and_price_freeze(api, tokens, buy):
    org = tokens["organizer"]
    fid = api("POST", "/api/festivals", org, {"name": "Test Fest", "venue_name": "Park", "city": "Bursa",
                                              "start_date": "2030-06-01", "end_date": "2030-06-02",
                                              "daily_capacity": 100}).data["festival_id"]
    status = lambda s: api("POST", f"/api/festivals/{fid}/status", org, {"status": s}).status_code  # noqa: E731
    ga = {"tier_name": "GA", "price": 100, "quota": 80, "sale_start": "2026-01-01 10:00", "sale_end": "2030-05-30 10:00"}

    assert status("ON_SALE") == 409, "needs a tier"
    assert api("POST", f"/api/festivals/{fid}/tiers", org, {**ga, "quota": 150}).status_code == 409, "quota > capacity"
    tier_id = api("POST", f"/api/festivals/{fid}/tiers", org, ga).data["tier_id"]
    assert status("COMPLETED") == 409
    assert status("ON_SALE") == 200
    assert buy(tokens["can"], fid, tier_id).status_code == 201
    r = api("PUT", f"/api/festivals/{fid}/tiers/{tier_id}", org, {**ga, "price": 200})
    assert r.status_code == 409 and "frozen" in r.data["error"]


def test_rules_7_and_13_cancellation_refunds(api, tokens):
    live = ("SELECT COUNT(*) FROM Tickets tk JOIN TicketTiers t ON t.tier_id = tk.tier_id "
            "WHERE t.festival_id = 3 AND tk.status IN ('VALID','CHECKED_IN')")
    assert db.scalar(live) > 0
    r = api("POST", "/api/festivals/3/status", tokens["organizer"], {"status": "CANCELLED"})
    assert r.status_code == 200 and r.data["summary"]["orders_refunded"] > 0
    assert db.scalar(live) == 0
    assert db.scalar("SELECT COUNT(*) FROM v_order_totals WHERE refunded_amount > captured_amount") == 0

    order_id = db.scalar("SELECT order_id FROM Orders WHERE festival_id = 1 AND status = 'PAID' LIMIT 1")
    with pytest.raises(pymysql.MySQLError, match="rule 13"):
        db.execute("INSERT INTO Payments (order_id, payment_type, amount, method, status, provider_ref) "
                   "VALUES (%s, 'REFUND', 99999, 'CARD', 'CAPTURED', 'TEST-OVER')", (order_id,))
    with pytest.raises(pymysql.MySQLError):  # exclusive arc: one order OR one allocation
        db.execute("INSERT INTO Payments (order_id, allocation_id, payment_type, amount, method, status, provider_ref) "
                   "VALUES (%s, 1, 'CHARGE', 1, 'CARD', 'CAPTURED', 'TEST-ARC')", (order_id,))


def test_webhook_is_idempotent(api, tokens, tier, buy):
    order_id = buy(tokens["ayse"], 1, tier(1, "Early Bird")["tier_id"]).data["order"]["order_id"]
    body = {"provider_ref": "PSP-TEST-123", "order_id": order_id, "amount": 1250, "method": "CARD", "status": "CAPTURED"}
    hook = lambda secret: api("POST", "/api/payments/webhook", body=body, headers={"X-Webhook-Secret": secret})  # noqa: E731
    assert hook("wrong").status_code == 401
    assert hook(settings.webhook_secret).data["order_paid"] is True
    assert hook(settings.webhook_secret).data["duplicate"] is True


def test_admin_manages_staff(api, tokens):
    staff = {"email": "gate3@festpass.com", "password": "Secret123", "full_name": "Gate Three",
             "date_of_birth": "1995-01-01", "role": "GATE_STAFF"}
    r = api("POST", "/api/admin/users", tokens["organizer"], staff)
    assert r.status_code == 201
    assert api("POST", "/api/admin/users", tokens["auditor"], {**staff, "email": "x@festpass.com"}).status_code == 403
    assert api("PATCH", f"/api/admin/users/{r.data['user']['user_id']}/status", tokens["organizer"],
               {"account_status": "SUSPENDED"}).status_code == 200
    assert api("POST", "/api/auth/login", body={"email": staff["email"], "password": "Secret123"}).status_code == 401
    assert api("GET", "/api/admin/users", tokens["ayse"]).status_code == 403
