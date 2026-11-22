"""Public catalogue plus organizer management of festivals, ticket tiers and the stall map."""
from typing import Literal

from fastapi import APIRouter

from ..db import db, transaction
from ..errors import Conflict, Forbidden, NotFound
from ..schemas import Festival, FestivalStatus, Id, Stall, Tier
from ..security import MaybeUser, Organizer, Staff, User
from ..services import festivals as svc
from ..services.vendors import ALLOC_SELECT, eligibility

router = APIRouter(prefix="/api/festivals", tags=["festivals"])

LIST_SELECT = """
    SELECT f.*, u.full_name AS organizer_name,
           (SELECT MIN(price) FROM TicketTiers t WHERE t.festival_id = f.festival_id) AS min_price,
           (SELECT COALESCE(SUM(remaining), 0) FROM v_tier_availability a WHERE a.festival_id = f.festival_id) AS tickets_remaining,
           (SELECT COALESCE(SUM(quota), 0) FROM TicketTiers t WHERE t.festival_id = f.festival_id) AS total_quota,
           (SELECT COUNT(*) FROM Stalls s WHERE s.festival_id = f.festival_id) AS stall_count,
           DATEDIFF(f.start_date, CURDATE()) AS days_until
      FROM Festivals f JOIN Users u ON u.user_id = f.organizer_id"""

FESTIVAL_COLUMNS = ("name", "venue_name", "city", "start_date", "end_date", "daily_capacity", "min_age")
TIER_COLUMNS = ("tier_name", "price", "quota", "max_per_order", "sale_start", "sale_end")
STALL_COLUMNS = ("stall_code", "zone", "size_m2", "has_power", "base_fee")


def values(body, columns):
    return tuple(getattr(body, c) for c in columns)


def assignments(columns):
    return ", ".join(f"{c} = %s" for c in columns)


def insider(user, festival):
    """Auditors and the festival's own organizer may see drafts and full stall details."""
    return user["role"] == "AUDITOR" or (user["role"] == "ORGANIZER" and festival["organizer_id"] == user["user_id"])


def editable(user, festival_id, action, closed=("COMPLETED", "CANCELLED")):
    f = svc.load_owned(db, user, festival_id)
    if f["status"] in closed:
        raise Conflict(f"Cannot {action} a {f['status']} festival")
    return f


# ------------------------------------------------------------------ catalogue
@router.get("")
def catalogue(q: str | None = None, city: str | None = None,
              status: Literal["ON_SALE", "LIVE", "COMPLETED", "CANCELLED"] | None = None):
    where, params = (["f.status = %s"], [status]) if status else (["f.status IN ('ON_SALE','LIVE')"], [])
    if q:
        where.append("(f.name LIKE %s OR f.venue_name LIKE %s OR f.city LIKE %s)")
        params += [f"%{q}%"] * 3
    if city:
        where.append("f.city = %s")
        params.append(city)
    festivals = db.fetch_all(f"{LIST_SELECT} WHERE {' AND '.join(where)} ORDER BY f.start_date", params)
    cities = db.fetch_all("SELECT DISTINCT city FROM Festivals WHERE status IN ('ON_SALE','LIVE') ORDER BY city")
    return {"festivals": festivals, "cities": [c["city"] for c in cities]}


@router.get("/mine")
def mine(user: Staff):
    own = user["role"] == "ORGANIZER"
    return {"festivals": db.fetch_all(
        f"""SELECT s.*, f.venue_name, f.city, f.min_age FROM v_festival_stats s JOIN Festivals f ON f.festival_id = s.festival_id
             {'WHERE f.organizer_id = %s' if own else ''}
             ORDER BY FIELD(s.status,'LIVE','ON_SALE','DRAFT','COMPLETED','CANCELLED'), s.start_date""",
        (user["user_id"],) if own else ())}


@router.get("/{festival_id}")
def detail(festival_id: Id, user: MaybeUser):
    f = db.fetch_one(f"{LIST_SELECT} WHERE f.festival_id = %s", (festival_id,))
    if not f or (f["status"] == "DRAFT" and not (user and insider(user, f))):
        raise NotFound("Festival not found")
    tiers = db.fetch_all(
        """SELECT a.*, (NOW() BETWEEN a.sale_start AND a.sale_end) AS on_sale_now, (NOW() < a.sale_start) AS sale_not_started
             FROM v_tier_availability a WHERE a.festival_id = %s ORDER BY a.price""", (festival_id,))
    return {"festival": f, "tiers": tiers, "next_statuses": svc.NEXT[f["status"]]}


# ----------------------------------------------------------------- organizer
@router.post("", status_code=201)
def create(body: Festival, user: Organizer):
    festival_id = db.insert(
        f"INSERT INTO Festivals (organizer_id, {', '.join(FESTIVAL_COLUMNS)}) VALUES (%s{', %s' * len(FESTIVAL_COLUMNS)})",
        (user["user_id"], *values(body, FESTIVAL_COLUMNS)))
    return {"festival_id": festival_id}


@router.put("/{festival_id}")
def update(festival_id: Id, body: Festival, user: Organizer):
    svc.assert_editable(svc.load_owned(db, user, festival_id), body)
    db.execute(f"UPDATE Festivals SET {assignments(FESTIVAL_COLUMNS)} WHERE festival_id = %s",
               (*values(body, FESTIVAL_COLUMNS), festival_id))
    return {"ok": True}


@router.post("/{festival_id}/status")
def change_status(festival_id: Id, body: FestivalStatus, user: Organizer):
    return svc.change_status(user, festival_id, body.status)


@router.delete("/{festival_id}")
def delete(festival_id: Id, user: Organizer):
    if svc.load_owned(db, user, festival_id)["status"] != "DRAFT":
        raise Conflict("Only DRAFT festivals can be deleted; cancel it instead")
    with transaction() as tx:
        tx.execute("DELETE FROM TicketTiers WHERE festival_id = %s", (festival_id,))
        tx.execute("DELETE FROM Festivals WHERE festival_id = %s", (festival_id,))
    return {"ok": True}


# ---------------------------------------------------------------------- tiers
@router.post("/{festival_id}/tiers", status_code=201)
def add_tier(festival_id: Id, body: Tier, user: Organizer):
    f = editable(user, festival_id, "add tiers to", closed=("COMPLETED", "CANCELLED", "LIVE"))
    svc.assert_tier_window(body, f)
    tier_id = db.insert(f"INSERT INTO TicketTiers (festival_id, {', '.join(TIER_COLUMNS)}) "
                        f"VALUES (%s{', %s' * len(TIER_COLUMNS)})", (festival_id, *values(body, TIER_COLUMNS)))
    return {"tier_id": tier_id}


@router.put("/{festival_id}/tiers/{tier_id}")
def update_tier(festival_id: Id, tier_id: Id, body: Tier, user: Organizer):
    svc.assert_tier_window(body, editable(user, festival_id, "edit tiers of"))
    if not db.execute(f"UPDATE TicketTiers SET {assignments(TIER_COLUMNS)} WHERE tier_id = %s AND festival_id = %s",
                      (*values(body, TIER_COLUMNS), tier_id, festival_id)):
        raise NotFound("Tier not found")
    return {"ok": True}


@router.delete("/{festival_id}/tiers/{tier_id}")
def delete_tier(festival_id: Id, tier_id: Id, user: Organizer):
    svc.load_owned(db, user, festival_id)
    if db.scalar("SELECT COUNT(*) FROM Tickets WHERE tier_id = %s", (tier_id,)):
        raise Conflict("Tiers with issued tickets cannot be deleted")
    db.execute("DELETE FROM TicketTiers WHERE tier_id = %s AND festival_id = %s", (tier_id, festival_id))
    return {"ok": True}


# --------------------------------------------------------------------- stalls
@router.get("/{festival_id}/stalls")
def stall_map(festival_id: Id, user: User):
    f = db.fetch_one("SELECT * FROM Festivals WHERE festival_id = %s", (festival_id,))
    staff = bool(f) and insider(user, f)
    if not f or (f["status"] == "DRAFT" and not staff):
        raise NotFound("Festival not found")
    stalls = db.fetch_all(
        """SELECT s.*, a.allocation_id AS approved_allocation_id, v.legal_name AS approved_vendor,
                  v.manager_id AS approved_manager_id,
                  (SELECT COUNT(*) FROM StallAllocations x WHERE x.stall_id = s.stall_id AND x.status = 'APPLIED') AS open_applications
             FROM Stalls s
             LEFT JOIN StallAllocations a ON a.stall_id = s.stall_id AND a.status = 'APPROVED'
             LEFT JOIN Vendors v ON v.vendor_id = a.vendor_id
            WHERE s.festival_id = %s ORDER BY FIELD(s.zone,'FOOD_COURT','MAIN_STAGE','CAMPING','ENTRANCE'), s.stall_code""",
        (festival_id,))
    for s in stalls:  # outsiders only learn that a stall is taken, not by whom
        manager_id = s.pop("approved_manager_id")
        if not staff and manager_id != user["user_id"]:
            s.update(approved_vendor="Allocated" if s["approved_vendor"] else None, approved_allocation_id=None)
    vendors = None
    if user["role"] == "VENDOR_MANAGER":
        vendors = [{"vendor_id": v["vendor_id"], "legal_name": v["legal_name"], **eligibility(v, f)}
                   for v in db.fetch_all("SELECT * FROM Vendors WHERE manager_id = %s", (user["user_id"],))]
    return {"festival": f, "stalls": stalls, "eligibility": vendors}


@router.post("/{festival_id}/stalls", status_code=201)
def add_stall(festival_id: Id, body: Stall, user: Organizer):
    editable(user, festival_id, "add stalls to")
    stall_id = db.insert(f"INSERT INTO Stalls (festival_id, {', '.join(STALL_COLUMNS)}) "
                         f"VALUES (%s{', %s' * len(STALL_COLUMNS)})", (festival_id, *values(body, STALL_COLUMNS)))
    return {"stall_id": stall_id}


@router.put("/{festival_id}/stalls/{stall_id}")
def update_stall(festival_id: Id, stall_id: Id, body: Stall, user: Organizer):
    svc.load_owned(db, user, festival_id)
    if not db.execute(f"UPDATE Stalls SET {assignments(STALL_COLUMNS)} WHERE stall_id = %s AND festival_id = %s",
                      (*values(body, STALL_COLUMNS), stall_id, festival_id)):
        raise NotFound("Stall not found")
    return {"ok": True}


@router.delete("/{festival_id}/stalls/{stall_id}")
def delete_stall(festival_id: Id, stall_id: Id, user: Organizer):
    svc.load_owned(db, user, festival_id)
    if db.scalar("SELECT COUNT(*) FROM StallAllocations WHERE stall_id = %s", (stall_id,)):
        raise Conflict("Stalls with applications cannot be deleted")
    db.execute("DELETE FROM Stalls WHERE stall_id = %s AND festival_id = %s", (stall_id, festival_id))
    return {"ok": True}


@router.get("/{festival_id}/allocations")
def applications(festival_id: Id, user: Staff):
    organizer_id = db.scalar("SELECT organizer_id FROM Festivals WHERE festival_id = %s", (festival_id,))
    if not organizer_id:
        raise NotFound("Festival not found")
    if user["role"] == "ORGANIZER" and organizer_id != user["user_id"]:
        raise Forbidden("You do not have permission to do this")
    return {"allocations": db.fetch_all(
        f"""{ALLOC_SELECT} WHERE f.festival_id = %s
             ORDER BY FIELD(a.status,'APPLIED','APPROVED','REJECTED','CANCELLED'), a.applied_at DESC""", (festival_id,))}
