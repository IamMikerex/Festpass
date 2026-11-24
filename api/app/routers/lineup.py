"""SQLModel + SQLite CRUD example: a simple artist line-up stored in api/festpass_demo.db."""
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session, select

from ..errors import NotFound
from ..models import Artist, ArtistCreate, ArtistUpdate, sqlite_session

router = APIRouter(prefix="/api/demo/artists", tags=["demo: SQLModel + SQLite CRUD"])
Db = Annotated[Session, Depends(sqlite_session)]


def load(db: Session, artist_id: int) -> Artist:
    artist = db.get(Artist, artist_id)
    if not artist:
        raise NotFound("Artist not found")
    return artist


@router.post("", response_model=Artist, status_code=201)
def create_artist(body: ArtistCreate, db: Db):
    artist = Artist.model_validate(body)
    db.add(artist)
    db.commit()
    db.refresh(artist)
    return artist


@router.get("", response_model=list[Artist])
def list_artists(db: Db, offset: int = 0, limit: Annotated[int, Query(ge=1, le=100)] = 100):
    return db.exec(select(Artist).offset(offset).limit(limit)).all()


@router.get("/{artist_id}", response_model=Artist)
def get_artist(artist_id: int, db: Db):
    return load(db, artist_id)


@router.patch("/{artist_id}", response_model=Artist)
def update_artist(artist_id: int, body: ArtistUpdate, db: Db):
    artist = load(db, artist_id)
    artist.sqlmodel_update(body.model_dump(exclude_unset=True))
    db.add(artist)
    db.commit()
    db.refresh(artist)
    return artist


@router.delete("/{artist_id}", status_code=204)
def delete_artist(artist_id: int, db: Db):
    db.delete(load(db, artist_id))
    db.commit()
