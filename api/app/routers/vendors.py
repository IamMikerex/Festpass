"""Vendor registry and stall applications (allocations)."""
from typing import Literal

from fastapi import APIRouter

from ..db import db, transaction
from ..errors import Conflict, Forbidden, NotFound
from ..schemas import Application, Approval, Id, Payment, Vendor, VendorStatus
from ..security import Organizer, StallParty, Staff, VendorManager
from ..services import vendors as svc

router = APIRouter(prefix="/api/vendors", tags=["vendors"])
allocations = APIRouter(prefix="/api/allocations", tags=["vendors"])

VENDOR_COLUMNS = ("legal_name", "tax_number", "category", "license_expiry", "hygiene_cert_expiry")


# ------------------------------------------------------------ vendor manager
@router.get("/mine")
def mine(user: VendorManager):
    return {"vendors": db.fetch_all(
        """SELECT v.*,
                  (SELECT COUNT(*) FROM StallAllocations a WHERE a.vendor_id = v.vendor_id AND a.status = 'APPROVED') AS approved_stalls,
                  (SELECT COUNT(*) FROM StallAllocations a WHERE a.vendor_id = v.vendor_id AND a.status = 'APPLIED') AS open_applications
             FROM Vendors v WHERE v.manager_id = %s ORDER BY v.legal_name""", (user["user_id"],))}


@router.post("", status_code=201)
def register(body: Vendor, user: VendorManager):
    vendor_id = db.insert(f"INSERT INTO Vendors (manager_id, {', '.join(VENDOR_COLUMNS)}) VALUES (%s, %s, %s, %s, %s, %s)",
                          (user["user_id"], *(getattr(body, c) for c in VENDOR_COLUMNS)))
    return {"vendor_id": vendor_id}


@router.put("/{vendor_id}")
def update(vendor_id: Id, body: Vendor, user: VendorManager):
    v = db.fetch_one("SELECT * FROM Vendors WHERE vendor_id = %s", (vendor_id,))
    if not v:
        raise NotFound("Vendor not found")
    if v["manager_id"] != user["user_id"]:
        raise Forbidden("You do not have permission to do this")
    if v["status"] == "BLACKLISTED":
        raise Conflict("Blacklisted vendors cannot be edited")
    identity_changed = body.tax_number != v["tax_number"] or body.category != v["category"]
    if identity_changed and db.scalar("SELECT COUNT(*) FROM StallAllocations WHERE vendor_id = %s", (vendor_id,)):
        raise Conflict("Tax number and category are locked once the vendor has applied for stalls")
    db.execute(f"UPDATE Vendors SET {', '.join(f'{c} = %s' for c in VENDOR_COLUMNS)} WHERE vendor_id = %s",
               (*(getattr(body, c) for c in VENDOR_COLUMNS), vendor_id))
    return {"ok": True}


# -------------------------------------------------------- organizer / auditor
@router.get("")
def registry(user: Staff, status: Literal["PENDING_REVIEW", "ACTIVE", "BLACKLISTED"] | None = None, q: str | None = None):
    where, params = ["1=1"], []
    if status:
        where.append("v.status = %s")
        params.append(status)
    if q:
        where.append("(v.legal_name LIKE %s OR v.tax_number LIKE %s)")
        params += [f"%{q}%"] * 2
    return {"vendors": db.fetch_all(
        f"""SELECT v.*, u.full_name AS manager_name, u.email AS manager_email,
                   (v.license_expiry < CURDATE()) AS license_expired,
                   (v.hygiene_cert_expiry IS NOT NULL AND v.hygiene_cert_expiry < CURDATE()) AS hygiene_expired,
                   (SELECT COUNT(*) FROM StallAllocations a WHERE a.vendor_id = v.vendor_id AND a.status = 'APPROVED') AS approved_stalls
              FROM Vendors v JOIN Users u ON u.user_id = v.manager_id
             WHERE {' AND '.join(where)}
             ORDER BY FIELD(v.status,'PENDING_REVIEW','ACTIVE','BLACKLISTED'), v.legal_name""", params)}


@router.post("/{vendor_id}/status")
def set_status(vendor_id: Id, body: VendorStatus, user: Organizer):
    with transaction() as tx:
        if not tx.scalar("SELECT vendor_id FROM Vendors WHERE vendor_id = %s FOR UPDATE", (vendor_id,)):
            raise NotFound("Vendor not found")
        tx.execute("UPDATE Vendors SET status = %s WHERE vendor_id = %s", (body.status, vendor_id))
        if body.status == "BLACKLISTED":  # open applications of a blacklisted vendor are rejected
            tx.execute("UPDATE StallAllocations SET status = 'REJECTED', reviewed_by = %s WHERE vendor_id = %s AND status = 'APPLIED'",
                       (user["user_id"], vendor_id))
    return {"ok": True}


# ---------------------------------------------------------------- allocations
@allocations.get("/mine")
def my_applications(user: VendorManager):
    return {"allocations": db.fetch_all(f"{svc.ALLOC_SELECT} WHERE v.manager_id = %s ORDER BY a.applied_at DESC",
                                        (user["user_id"],))}


@allocations.get("/pending")
def review_queue(user: Organizer):
    rows = db.fetch_all(f"{svc.ALLOC_SELECT} WHERE f.organizer_id = %s AND a.status = 'APPLIED' ORDER BY a.applied_at",
                        (user["user_id"],))
    return {"allocations": [{**a, **svc.eligibility({**a, "status": a["vendor_status"]}, a)} for a in rows]}


@allocations.post("", status_code=201)
def apply(body: Application, user: VendorManager):
    return {"allocation": svc.get_allocation(svc.apply(user, body.vendor_id, body.stall_id))}


@allocations.post("/{allocation_id}/approve")
def approve(allocation_id: Id, user: Organizer, body: Approval | None = None):
    svc.approve(user, allocation_id, body.agreed_fee if body else None)
    return {"allocation": svc.get_allocation(allocation_id)}


@allocations.post("/{allocation_id}/reject")
def reject(allocation_id: Id, user: Organizer):
    svc.reject(user, allocation_id)
    return {"ok": True}


@allocations.post("/{allocation_id}/cancel")
def cancel(allocation_id: Id, user: StallParty):
    return svc.cancel(user, allocation_id)


@allocations.post("/{allocation_id}/pay")
def pay(allocation_id: Id, body: Payment, user: VendorManager):
    return svc.pay(user, allocation_id, body.method, body.card_number)
