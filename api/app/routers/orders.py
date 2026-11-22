from fastapi import APIRouter

from ..db import db
from ..errors import Forbidden, NotFound
from ..schemas import Id, NewOrder, Payment
from ..security import User
from ..services import orders as svc

router = APIRouter(prefix="/api/orders", tags=["orders"])


@router.post("", status_code=201)
def create(body: NewOrder, user: User):
    return {"order": svc.get_order(svc.create_order(user, body.festival_id, body.items))}


@router.get("")
def mine(user: User):
    return {"orders": db.fetch_all(f"{svc.ORDER_SELECT} WHERE ot.buyer_id = %s ORDER BY ot.created_at DESC",
                                   (user["user_id"],))}


@router.get("/{order_id}")
def detail(order_id: Id, user: User):
    order = svc.get_order(order_id)
    if not order:
        raise NotFound("Order not found")
    if order["buyer_id"] != user["user_id"] and user["role"] != "AUDITOR":
        organizer_id = db.scalar("SELECT organizer_id FROM Festivals WHERE festival_id = %s", (order["festival_id"],))
        if not (user["role"] == "ORGANIZER" and organizer_id == user["user_id"]):
            raise Forbidden("You do not have permission to do this")
    return {"order": order}


@router.post("/{order_id}/pay")
def pay(order_id: Id, body: Payment, user: User):
    return {**svc.pay_order(user, order_id, body.method, body.card_number), "order": svc.get_order(order_id)}


@router.post("/{order_id}/cancel")
def cancel(order_id: Id, user: User):
    svc.cancel_pending(user, order_id)
    return {"ok": True}
