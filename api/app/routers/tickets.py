from fastapi import APIRouter

from ..schemas import TicketId, Transfer
from ..security import User
from ..services import tickets as svc

router = APIRouter(prefix="/api/tickets", tags=["tickets"])


@router.get("")
def mine(user: User):
    return {"tickets": svc.list_mine(user)}


@router.get("/{ticket_id}")
def detail(ticket_id: TicketId, user: User):
    return {"ticket": svc.get_ticket(user, ticket_id, include_qr=True)}


@router.get("/{ticket_id}/history")
def history(ticket_id: TicketId, user: User):
    return svc.history(user, ticket_id)


@router.post("/{ticket_id}/transfer")
def transfer(ticket_id: TicketId, body: Transfer, user: User):
    return svc.transfer(user, ticket_id, body.email)


@router.post("/{ticket_id}/refund")
def refund(ticket_id: TicketId, user: User):
    return svc.refund(user, ticket_id)
