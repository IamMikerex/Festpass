"""Scheduled jobs: checkout expiry (rule 3), stall-fee deadline (rule 11), festival lifecycle (rule 12)."""
import asyncio
import logging

from .config import settings
from .services import festivals, orders, vendors

log = logging.getLogger("festpass.jobs")

JOBS = {
    "expired_orders": orders.expire_stale,
    "cancelled_allocations": vendors.cancel_overdue,
    "festival_transitions": festivals.advance_lifecycle,
}


def run_once():
    done = {}
    for name, job in JOBS.items():
        try:
            done[name] = job()
        except Exception:  # one failing job must not stop the others
            log.exception("Job %s failed", name)
    if any(done.values()):
        log.info("jobs %s", done)
    return done


async def run_forever():
    while True:
        await asyncio.to_thread(run_once)
        await asyncio.sleep(settings.jobs_interval)
