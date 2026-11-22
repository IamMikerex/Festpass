"""HTTP errors and their JSON shape: {"error": message, "details": ...}."""
import logging
import re

import pymysql
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("festpass")


class ApiError(Exception):
    status = 400

    def __init__(self, message, details=None, status=None):
        super().__init__(message)
        self.message, self.details = message, details
        self.status = status or self.status


class BadRequest(ApiError): status = 400
class Unauthorized(ApiError): status = 401
class PaymentFailed(ApiError): status = 402
class Forbidden(ApiError): status = 403
class NotFound(ApiError): status = 404
class Conflict(ApiError): status = 409
class Gone(ApiError): status = 410


DUPLICATE_KEYS = {
    "Users.uq_users_email": "An account with this email already exists",
    "Users.uq_users_phone": "This phone number is already registered",
    "Festivals.uq_festivals_name_start": "A festival with this name and start date already exists",
    "TicketTiers.uq_tiers_festival_name": "This festival already has a tier with that name",
    "TicketTransfers.uq_transfers_ticket": "This ticket has already been transferred once (rule 5)",
    "Payments.uq_payments_provider_ref": "This payment was already processed (duplicate provider reference)",
    "Vendors.uq_vendors_tax": "A vendor with this tax number is already registered",
    "Stalls.uq_stalls_code": "This festival already has a stall with that code",
    "StallAllocations.uq_alloc_one_approved": "This stall already has an approved vendor (rule 10)",
}

ER_DUP_ENTRY, ER_SIGNAL = 1062, 1644


def from_mysql(err: pymysql.MySQLError) -> ApiError | None:
    """Translates trigger SIGNALs and constraint violations into HTTP errors."""
    code, message = (err.args + (None, ""))[:2]
    if code == ER_SIGNAL:
        return Conflict(message)
    if code == ER_DUP_ENTRY:
        key = re.search(r"for key '([^']+)'", message or "")
        return Conflict(DUPLICATE_KEYS.get(key and key.group(1), "Duplicate value"))
    if code == 3819:
        return BadRequest(f"Constraint violated: {message}")
    if code in (1217, 1451):
        return Conflict("This record is referenced by other records and cannot be deleted")
    if code in (1216, 1452):
        return BadRequest("A referenced record does not exist")
    if code in (1205, 1213):
        return ApiError("The system is busy, please try again", status=503)
    return None


def _body(err: ApiError):
    return JSONResponse({"error": err.message, "details": err.details}, status_code=err.status)


def install(app: FastAPI):
    @app.exception_handler(ApiError)
    async def api_error(_: Request, err: ApiError):
        return _body(err)

    @app.exception_handler(pymysql.MySQLError)
    async def mysql_error(_: Request, err: pymysql.MySQLError):
        mapped = from_mysql(err)
        if mapped:
            return _body(mapped)
        log.exception("Unhandled database error", exc_info=err)
        return _body(ApiError("Something went wrong on our side", status=500))

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_: Request, err: RequestValidationError):
        issues = [{"field": ".".join(map(str, e["loc"][1:])), "message": e["msg"].removeprefix("Value error, ")}
                  for e in err.errors()]
        text = "; ".join(f"{i['field']}: {i['message']}" if i["field"] else i["message"] for i in issues)
        return _body(BadRequest(text, issues))

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, err: StarletteHTTPException):
        return _body(ApiError(err.detail if isinstance(err.detail, str) else "Request failed", status=err.status_code))
