"""Request bodies. Field rules mirror the CHECK constraints in database/festpass.sql."""
import datetime as dt
import re
from typing import Annotated, Literal

from fastapi import Path
from pydantic import AfterValidator, BaseModel, BeforeValidator, Field, StringConstraints, model_validator

EMAIL = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
UUID = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"


def _blank_to_none(v):
    return None if isinstance(v, str) and not v.strip() else v


def _password(v: str) -> str:
    if not re.search(r"[A-Za-z]", v) or not re.search(r"[0-9]", v):
        raise ValueError("Password must contain a letter and a number")
    return v


def _born(v: dt.date) -> dt.date:
    if not dt.date(1900, 1, 1) < v < dt.date.today():
        raise ValueError("Invalid date of birth")
    return v


def _optional_email(v: str) -> str:
    v = v.strip().lower()
    if v and not re.match(EMAIL, v):
        raise ValueError("Enter a valid email address")
    return v


def _email(v: str) -> str:
    if not (v := _optional_email(v)):
        raise ValueError("Enter a valid email address")
    return v


def _phone(v):
    if v is None or not str(v).strip():
        return None
    if not re.fullmatch(r"\+?[0-9 ]{7,20}", str(v).strip()):
        raise ValueError("Invalid phone number")
    return str(v).replace(" ", "")


def text(lo: int, hi: int):
    return Annotated[str, StringConstraints(strip_whitespace=True, min_length=lo, max_length=hi)]


Email = Annotated[str, Field(max_length=150), AfterValidator(_email)]
Password = Annotated[str, Field(min_length=8, max_length=72), AfterValidator(_password)]
Phone = Annotated[str | None, BeforeValidator(_phone)]
BirthDate = Annotated[dt.date, AfterValidator(_born)]
Money = Annotated[float, Field(ge=0, le=99_999_999.99), AfterValidator(lambda v: round(v, 2))]
Method = Literal["CARD", "BANK_TRANSFER", "WALLET"]
Id = Annotated[int, Path(gt=0)]
TicketId = Annotated[str, Path(pattern=UUID)]
Role = Literal["ORGANIZER", "GATE_STAFF", "AUDITOR", "VENDOR_MANAGER", "ATTENDEE"]


# ------------------------------------------------------------------ accounts
class Register(BaseModel):
    email: Email
    password: Password
    full_name: text(2, 100)
    phone: Phone = None
    date_of_birth: BirthDate
    role: Literal["ATTENDEE", "VENDOR_MANAGER"] = "ATTENDEE"  # staff accounts are created by organizers


class NewUser(Register):
    role: Role


class Login(BaseModel):
    email: Email
    password: Annotated[str, Field(min_length=1)]


class ProfileUpdate(BaseModel):
    full_name: text(2, 100) | None = None
    phone: Phone = None


class PasswordChange(BaseModel):
    current_password: Annotated[str, Field(min_length=1)]
    new_password: Password


class AccountStatus(BaseModel):
    account_status: Literal["ACTIVE", "SUSPENDED", "DELETED"]


# ----------------------------------------------------------------- festivals
class Festival(BaseModel):
    name: text(3, 120)
    venue_name: text(2, 120)
    city: text(2, 60)
    start_date: dt.date
    end_date: dt.date
    daily_capacity: Annotated[int, Field(gt=0, le=1_000_000)]
    min_age: Annotated[int, Field(ge=0, le=21)] = 16

    @model_validator(mode="after")
    def _dates(self):
        if self.end_date < self.start_date:
            raise ValueError("End date must be on or after the start date")
        return self


class FestivalStatus(BaseModel):
    status: Literal["ON_SALE", "LIVE", "COMPLETED", "CANCELLED"]


class Tier(BaseModel):
    tier_name: text(2, 60)
    price: Money
    quota: Annotated[int, Field(gt=0)]
    max_per_order: Annotated[int, Field(ge=1, le=10)] = 6
    sale_start: dt.datetime
    sale_end: dt.datetime

    @model_validator(mode="after")
    def _window(self):
        if self.sale_end <= self.sale_start:
            raise ValueError("Sale end must be after sale start")
        return self


class Stall(BaseModel):
    stall_code: Annotated[str, StringConstraints(strip_whitespace=True, to_upper=True, min_length=1, max_length=10,
                                                 pattern=r"^[A-Za-z0-9-]+$")]
    zone: Literal["FOOD_COURT", "MAIN_STAGE", "CAMPING", "ENTRANCE"]
    size_m2: Annotated[float, Field(gt=0, le=999.99)]
    has_power: bool = False
    base_fee: Money


# -------------------------------------------------------------------- orders
class OrderLine(BaseModel):
    tier_id: Annotated[int, Field(gt=0)]
    quantity: Annotated[int, Field(ge=1, le=10)]
    holder_emails: Annotated[list[Annotated[str, AfterValidator(_optional_email)]], Field(max_length=10)] = []


class NewOrder(BaseModel):
    festival_id: Annotated[int, Field(gt=0)]
    items: Annotated[list[OrderLine], Field(min_length=1, max_length=10)]


class Payment(BaseModel):
    method: Method
    card_number: Annotated[str, StringConstraints(strip_whitespace=True, max_length=23)] | None = None

    @model_validator(mode="after")
    def _card(self):
        if self.method == "CARD" and len(re.sub(r"\D", "", self.card_number or "")) < 12:
            raise ValueError("Enter a card number")
        return self


class Webhook(BaseModel):
    provider_ref: text(4, 64)
    order_id: Annotated[int, Field(gt=0)]
    amount: Annotated[float, Field(gt=0)]
    method: Method
    status: Literal["AUTHORIZED", "CAPTURED", "FAILED"]


# ------------------------------------------------------------ tickets & gate
class Transfer(BaseModel):
    email: Email


class Scan(BaseModel):
    qr_token: Annotated[str, StringConstraints(strip_whitespace=True, to_lower=True, pattern=r"^[0-9a-f]{64}$")]
    gate_code: Annotated[str, StringConstraints(strip_whitespace=True, to_upper=True, min_length=1, max_length=10)]
    direction: Literal["IN", "OUT"]
    festival_id: Annotated[int, Field(gt=0)] | None = None


# ------------------------------------------------------------------- vendors
class Vendor(BaseModel):
    legal_name: text(2, 150)
    tax_number: Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^[0-9]{10}$")]
    category: Literal["FOOD", "BEVERAGE", "MERCH", "SERVICE"]
    license_expiry: dt.date
    hygiene_cert_expiry: Annotated[dt.date | None, BeforeValidator(_blank_to_none)] = None

    @model_validator(mode="after")
    def _hygiene(self):
        if self.category in ("FOOD", "BEVERAGE") and not self.hygiene_cert_expiry:
            raise ValueError("Food and beverage vendors must provide a hygiene certificate expiry date")
        return self


class VendorStatus(BaseModel):
    status: Literal["ACTIVE", "BLACKLISTED", "PENDING_REVIEW"]


class Application(BaseModel):
    vendor_id: Annotated[int, Field(gt=0)]
    stall_id: Annotated[int, Field(gt=0)]


class Approval(BaseModel):
    agreed_fee: Money | None = None
