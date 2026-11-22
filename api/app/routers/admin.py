"""Account management. Organizers create staff accounts; users are never hard-deleted."""
from fastapi import APIRouter

from ..db import db
from ..errors import Conflict, NotFound
from ..schemas import AccountStatus, Id, NewUser, Role
from ..security import USER_COLUMNS, Organizer, Staff
from .auth import create_user

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/users")
def list_users(user: Staff, role: Role | None = None, q: str | None = None):
    where, params = ["1=1"], []
    if role:
        where.append("role = %s")
        params.append(role)
    if q:
        where.append("(full_name LIKE %s OR email LIKE %s)")
        params += [f"%{q}%"] * 2
    return {"users": db.fetch_all(
        f"""SELECT {USER_COLUMNS} FROM Users WHERE {' AND '.join(where)}
             ORDER BY FIELD(role,'ORGANIZER','GATE_STAFF','AUDITOR','VENDOR_MANAGER','ATTENDEE'), full_name LIMIT 500""",
        params)}


@router.post("/users", status_code=201)
def add_user(body: NewUser, user: Organizer):
    return {"user": create_user(body)}


@router.patch("/users/{user_id}/status")
def set_status(user_id: Id, body: AccountStatus, user: Organizer):
    if user_id == user["user_id"]:
        raise Conflict("You cannot change your own account status")
    current = db.scalar("SELECT account_status FROM Users WHERE user_id = %s", (user_id,))
    if not current:
        raise NotFound("User not found")
    if current == "DELETED":
        raise Conflict("Deleted accounts cannot be reactivated")
    if body.account_status == "DELETED":  # keep the financial history, anonymise the person (KVKK)
        db.execute("""UPDATE Users SET account_status = 'DELETED', email = CONCAT('deleted-', user_id, '@festpass.invalid'),
                             full_name = 'Deleted user', phone = NULL WHERE user_id = %s""", (user_id,))
    else:
        db.execute("UPDATE Users SET account_status = %s WHERE user_id = %s", (body.account_status, user_id))
    return {"ok": True}
