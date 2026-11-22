"""Logging for the analytics service: JSON lines in production (or LOG_FORMAT=json), plain text otherwise."""
import json
import logging
import sys
import time

from .config import settings


class JsonFormatter(logging.Formatter):
    def format(self, record):
        out = {
            "time": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created)) + f".{int(record.msecs):03d}Z",
            "level": record.levelname.lower(), "service": "festpass-analytics", "msg": record.getMessage(),
        }
        out.update(getattr(record, "fields", {}))
        if record.exc_info:
            out["err"] = self.formatException(record.exc_info)
        return json.dumps(out, default=str)


class TextFormatter(logging.Formatter):
    def format(self, record):
        fields = " ".join(f"{k}={v}" for k, v in getattr(record, "fields", {}).items())
        line = f"[{record.levelname.lower()}] {record.getMessage()}{' ' + fields if fields else ''}"
        if record.exc_info:
            line += "\n" + self.formatException(record.exc_info)
        return line


def setup():
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter() if settings.log_json else TextFormatter())
    log = logging.getLogger("festpass")
    log.handlers[:] = [handler]
    log.setLevel(settings.log_level)
    log.propagate = False
    return log
