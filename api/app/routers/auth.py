from fastapi import APIRouter, Depends

from ..db import db
from ..errors import BadRequest, Conflict, Unauthorized
from ..schemas import Login, PasswordChange, ProfileUpdate, Register
from ..security import USER_COLUMNS, User, check_password, hash_password, issue_token, sign_in_limit

router = APIRouter(prefix="/api/auth", tags=["auth"])


def load_user(user_id):
    return db.fetch_one(f"SELECT {USER_COLUMNS} FROM Users WHERE user_id = %s", (user_id,))


def create_user(body: Register):
    return load_user(db.insert(
        "INSERT INTO Users (email, password_hash, full_name, phone, date_of_birth, role) VALUES (%s, %s, %s, %s, %s, %s)",
        (body.email, hash_password(body.password), body.full_name, body.phone, body.date_of_birth, body.role)))


@router.post("/register", status_code=201, dependencies=[Depends(sign_in_limit)])
def register(body: Register):
    user = create_user(body)
    return {"token": issue_token(user), "user": user}


@router.post("/login", dependencies=[Depends(sign_in_limit)])
def login(body: Login):
    row = db.fetch_one("SELECT user_id, password_hash, account_status FROM Users WHERE email = %s", (body.email,))
    # One message for unknown email and wrong password: no account enumeration.
    if not row or not check_password(body.password, row["password_hash"]):
        raise Unauthorized("Incorrect email or password")
    if row["account_status"] != "ACTIVE":
        raise Unauthorized(f"This account is {row['account_status'].lower()}")
    user = load_user(row["user_id"])
    return {"token": issue_token(user), "user": user}


@router.get("/me")
def me(user: User):
    return {"user": user}


@router.put("/me")
def update_me(body: ProfileUpdate, user: User):
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        raise BadRequest("Nothing to update")
    assignments = ", ".join(f"{column} = %s" for column in changes)
    db.execute(f"UPDATE Users SET {assignments} WHERE user_id = %s", (*changes.values(), user["user_id"]))
    return {"user": load_user(user["user_id"])}


@router.put("/password")
def change_password(body: PasswordChange, user: User):
    hashed = db.scalar("SELECT password_hash FROM Users WHERE user_id = %s", (user["user_id"],))
    if not check_password(body.current_password, hashed):
        raise Conflict("Current password is incorrect")
    db.execute("UPDATE Users SET password_hash = %s WHERE user_id = %s", (hash_password(body.new_password), user["user_id"]))
    return {"ok": True}
