from fastapi import APIRouter

from ..schemas import Scan
from ..security import GateStaff
from ..services import scans as svc

router = APIRouter(prefix="/api/scans", tags=["gate"])


@router.post("")
def scan(body: Scan, user: GateStaff):
    return svc.scan(user, body.qr_token, body.gate_code, body.direction, body.festival_id)


@router.get("/recent")
def recent(user: GateStaff):
    return {"scans": svc.recent_for(user)}


@router.get("/festivals")
def festivals(user: GateStaff):
    return {"festivals": svc.festivals_today()}
