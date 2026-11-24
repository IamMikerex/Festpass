"""
SQLModel layer.

1) `Festival` / `TicketTier` map the existing MySQL tables (created by database/festpass.sql, never by
   SQLModel, so the triggers, CHECKs and views stay in charge). Used by routers/catalog.py.
2) `Artist` lives in a separate SQLite file (api/data/festpass_demo.db), created on startup. Used by
   routers/lineup.py as a plain SQLModel CRUD example you can open with VS Code's SQLite Viewer.
"""
from datetime import date, datetime
from decimal import Decimal
from urllib.parse import quote_plus

from sqlmodel import Field, Relationship, Session, SQLModel, create_engine

from .config import settings
from .db import _TZ

# ---------------------------------------------------------------- MySQL (existing FestPass tables)
mysql_engine = create_engine(
    f"mysql+pymysql://{quote_plus(settings.db_user)}:{quote_plus(settings.db_password)}"
    f"@{settings.db_host}:{settings.db_port}/{settings.db_name}?charset=utf8mb4",
    pool_pre_ping=True, connect_args={"init_command": f"SET time_zone = '{_TZ}'"},
)


class Festival(SQLModel, table=True):
    __tablename__ = "Festivals"
    festival_id: int | None = Field(default=None, primary_key=True)
    organizer_id: int
    name: str
    venue_name: str
    city: str
    start_date: date
    end_date: date
    daily_capacity: int
    min_age: int
    status: str
    tiers: list["TicketTier"] = Relationship(back_populates="festival")


class TicketTier(SQLModel, table=True):
    __tablename__ = "TicketTiers"
    tier_id: int | None = Field(default=None, primary_key=True)
    festival_id: int = Field(foreign_key="Festivals.festival_id")
    tier_name: str
    price: Decimal
    quota: int
    max_per_order: int
    sale_start: datetime
    sale_end: datetime
    festival: Festival | None = Relationship(back_populates="tiers")


class TierRead(SQLModel):
    tier_id: int
    tier_name: str
    price: float
    quota: int
    max_per_order: int
    sale_start: datetime
    sale_end: datetime


class FestivalRead(SQLModel):
    festival_id: int
    name: str
    venue_name: str
    city: str
    start_date: date
    end_date: date
    daily_capacity: int
    min_age: int
    status: str


class FestivalWithTiers(FestivalRead):
    tiers: list[TierRead] = []


def mysql_session():
    with Session(mysql_engine) as session:
        yield session


# ---------------------------------------------------------------- SQLite (SQLModel CRUD example)
settings.data_dir.mkdir(parents=True, exist_ok=True)
SQLITE_FILE = settings.data_dir / "festpass_demo.db"
sqlite_engine = create_engine(f"sqlite:///{SQLITE_FILE}", connect_args={"check_same_thread": False})


class ArtistBase(SQLModel):
    name: str = Field(min_length=1, max_length=80, index=True)
    genre: str = Field(default="Mixed", max_length=40)
    country: str | None = Field(default=None, max_length=60)


class Artist(ArtistBase, table=True):
    id: int | None = Field(default=None, primary_key=True)


class ArtistCreate(ArtistBase):
    pass


class ArtistUpdate(SQLModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    genre: str | None = Field(default=None, max_length=40)
    country: str | None = Field(default=None, max_length=60)


def create_sqlite_tables():
    SQLModel.metadata.create_all(sqlite_engine, tables=[Artist.__table__])  # never touches MySQL


def sqlite_session():
    with Session(sqlite_engine) as session:
        yield session
