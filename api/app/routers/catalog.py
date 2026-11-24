"""Read-only festival catalogue served through SQLModel on the existing MySQL tables."""
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import selectinload
from sqlmodel import Session, select

from ..errors import NotFound
from ..models import Festival, FestivalRead, FestivalWithTiers, mysql_session

router = APIRouter(prefix="/api/catalog", tags=["catalog (SQLModel + MySQL)"])
Db = Annotated[Session, Depends(mysql_session)]


@router.get("/festivals", response_model=list[FestivalRead])
def list_festivals(db: Db, city: str | None = None, limit: Annotated[int, Query(ge=1, le=100)] = 50):
    query = select(Festival).where(Festival.status != "DRAFT").order_by(Festival.start_date).limit(limit)
    if city:
        query = query.where(Festival.city == city)
    return db.exec(query).all()


@router.get("/festivals/{festival_id}", response_model=FestivalWithTiers)
def get_festival(festival_id: int, db: Db):
    festival = db.exec(select(Festival).where(Festival.festival_id == festival_id, Festival.status != "DRAFT")
                       .options(selectinload(Festival.tiers))).first()
    if not festival:
        raise NotFound("Festival not found")
    return festival
