"""Password hashing, JWT sessions, role guards and sign-in rate limiting."""
import time
from collections import defaultdict, deque
from typing import Annotated

import bcrypt
import jwt
from fastapi import Depends, Header, Request

from .config import settings
from .db import db
from .errors import ApiError, Forbidden, Unauthorized

USER_COLUMNS = "user_id, email, full_name, phone, date_of_birth, role, account_status, created_at"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode()[:72], bcrypt.gensalt(10)).decode()


def check_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode()[:72], hashed.encode())


def issue_token(user) -> str:
    claims = {"sub": str(user["user_id"]), "role": user["role"], "exp": int(time.time()) + settings.jwt_hours * 3600}
    return jwt.encode(claims, settings.jwt_secret, algorithm="HS256")


def current_user(authorization: str = Header(default="")):
    scheme, _, token = authorization.partition(" ")
    if scheme != "Bearer" or not token:
        raise Unauthorized("Authentication required")
    try:
        user_id = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])["sub"]
    except (jwt.PyJWTError, KeyError):
        raise Unauthorized("Session expired, please sign in again") from None
    user = db.fetch_one(f"SELECT {USER_COLUMNS} FROM Users WHERE user_id = %s", (user_id,))
    if not user or user["account_status"] != "ACTIVE":
        raise Unauthorized("Account is not active")
    return user


def optional_user(authorization: str = Header(default="")):
    try:
        return current_user(authorization) if authorization else None
    except Unauthorized:
        return None


def require_role(*roles):
    def guard(user=Depends(current_user)):
        if user["role"] not in roles:
            raise Forbidden("You do not have permission to do this")
        return user

    return guard


User = Annotated[dict, Depends(current_user)]
MaybeUser = Annotated[dict | None, Depends(optional_user)]
Organizer = Annotated[dict, Depends(require_role("ORGANIZER"))]
Staff = Annotated[dict, Depends(require_role("ORGANIZER", "AUDITOR"))]
VendorManager = Annotated[dict, Depends(require_role("VENDOR_MANAGER"))]
GateStaff = Annotated[dict, Depends(require_role("GATE_STAFF"))]
StallParty = Annotated[dict, Depends(require_role("ORGANIZER", "VENDOR_MANAGER"))]


class RateLimit:
    """Sliding-window limit per client IP (in memory, one process)."""

    def __init__(self, limit: int, window_seconds: int, message: str):
        self.limit, self.window, self.message = limit, window_seconds, message
        self.hits: dict[str, deque] = defaultdict(deque)

    def __call__(self, request: Request):
        now, hits = time.monotonic(), self.hits[request.client.host if request.client else "?"]
        while hits and now - hits[0] > self.window:
            hits.popleft()
        if len(hits) >= self.limit:
            raise ApiError(self.message, status=429)
        hits.append(now)


sign_in_limit = RateLimit(30, 15 * 60, "Too many sign-in attempts, try again in a few minutes")
