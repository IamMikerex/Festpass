"""
Simulated payment gateway. A real PSP (iyzico, Stripe...) would replace charge/refund.
Test rule: a card number ending in 0002 is declined; everything else is captured.
"""
import re
import secrets
import time
from dataclasses import dataclass


@dataclass(frozen=True)
class Charge:
    provider_ref: str
    status: str
    decline_reason: str | None = None


def _reference(prefix: str) -> str:
    return f"{prefix}-{int(time.time() * 1000):X}-{secrets.token_hex(5).upper()}"


def charge(method: str, card_number: str | None = None) -> Charge:
    if method == "CARD" and re.sub(r"\D", "", card_number or "").endswith("0002"):
        return Charge(_reference("FP"), "FAILED", "Card declined by issuer")
    return Charge(_reference("FP"), "CAPTURED")


def refund_reference() -> str:
    return _reference("RF")


def new_qr_token() -> str:
    return secrets.token_hex(32)  # 256-bit, CHAR(64)
