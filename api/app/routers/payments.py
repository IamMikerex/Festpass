import hmac

import pymysql
from fastapi import APIRouter, Header

from ..config import settings
from ..db import db, transaction
from ..errors import ER_DUP_ENTRY, Conflict, NotFound, Unauthorized
from ..schemas import Webhook
from ..security import User
from ..services.orders import apply_charge

router = APIRouter(prefix="/api/payments", tags=["payments"])


@router.post("/webhook")
def webhook(body: Webhook, x_webhook_secret: str = Header(default="")):
    """Gateway callback. Idempotent: provider_ref is UNIQUE, so a redelivery is acknowledged but not applied twice."""
    if not hmac.compare_digest(x_webhook_secret.encode(), settings.webhook_secret.encode()):
        raise Unauthorized("Bad webhook signature")
    existing = db.scalar("SELECT payment_id FROM Payments WHERE provider_ref = %s", (body.provider_ref,))
    if existing:
        return {"ok": True, "duplicate": True, "payment_id": existing}
    try:
        with transaction() as tx:
            status = tx.scalar("SELECT status FROM Orders WHERE order_id = %s FOR UPDATE", (body.order_id,))
            if not status:
                raise NotFound("Order not found")
            if status != "PENDING":
                raise Conflict(f"Order is {status}")
            paid = apply_charge(tx, body.order_id, body.amount, body.method, body.provider_ref, body.status)
    except pymysql.err.IntegrityError as err:
        if err.args[0] != ER_DUP_ENTRY:
            raise
        return {"ok": True, "duplicate": True}
    return {"ok": True, "duplicate": False, "order_paid": paid}


@router.get("/mine")
def mine(user: User):
    """The user's money trail: ticket orders they bought and stall fees of vendors they manage."""
    rows = db.fetch_all(
        """SELECT p.*, 'TICKET_ORDER' AS context, CONCAT('Order #', o.order_id, ' · ', f.name) AS description
             FROM Payments p JOIN Orders o ON o.order_id = p.order_id JOIN Festivals f ON f.festival_id = o.festival_id
            WHERE o.buyer_id = %s
           UNION ALL
           SELECT p.*, 'STALL_FEE', CONCAT('Stall ', s.stall_code, ' · ', f.name, ' · ', v.legal_name)
             FROM Payments p JOIN StallAllocations a ON a.allocation_id = p.allocation_id
             JOIN Vendors v ON v.vendor_id = a.vendor_id JOIN Stalls s ON s.stall_id = a.stall_id
             JOIN Festivals f ON f.festival_id = s.festival_id
            WHERE v.manager_id = %s
           ORDER BY processed_at DESC, payment_id DESC""", (user["user_id"], user["user_id"]))

    def captured(kind):
        return round(sum(r["amount"] for r in rows if r["payment_type"] == kind and r["status"] == "CAPTURED"), 2)

    charged, refunded = captured("CHARGE"), captured("REFUND")
    return {"payments": rows, "totals": {"charged": charged, "refunded": refunded, "net": round(charged - refunded, 2)}}
