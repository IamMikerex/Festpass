"""Verifies the JWT issued by the Express API (shared HS256 secret) and enforces roles."""
from fastapi import Depends, Header, HTTPException

import jwt

from . import db
from .config import settings


def current_user(authorization: str = Header(default="")):
    scheme, _, token = authorization.partition(" ")
    if scheme != "Bearer" or not token:
        raise HTTPException(status_code=401, detail="Authentication required")
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Session expired, please sign in again")
    with db.connection() as conn:
        user = db.fetch_one(
            conn, "SELECT user_id, email, full_name, role, account_status FROM Users WHERE user_id = %s", (payload.get("sub"),)
        )
    if not user or user["account_status"] != "ACTIVE":
        raise HTTPException(status_code=401, detail="Account is not active")
    return user


def require_roles(*roles):
    def checker(user=Depends(current_user)):
        if user["role"] not in roles:
            raise HTTPException(status_code=403, detail="You do not have permission to do this")
        return user

    return checker


staff = require_roles("ORGANIZER", "AUDITOR")
