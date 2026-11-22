"""
End-to-end fixtures: rebuild the database once, then run the real API on a free port.
WARNING: the session drops and recreates the `festpass` database.
"""
import os
import socket
import threading
import time

os.environ["JOBS_INTERVAL_SECONDS"] = "0"  # tests trigger jobs explicitly

import httpx  # noqa: E402
import pytest  # noqa: E402
import uvicorn  # noqa: E402

from app.main import app  # noqa: E402
from scripts import init_db  # noqa: E402

USERS = ["ayse", "can", "elif", "deniz", "organizer", "organizer2", "gate", "auditor", "vendor", "vendor2"]


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="session")
def base_url():
    init_db.main()
    port = _free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", ws="none"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    while not server.started:
        time.sleep(0.05)
    yield f"http://127.0.0.1:{port}"
    server.should_exit = True
    thread.join(timeout=5)


class Api:
    def __init__(self, base_url):
        self.http = httpx.Client(base_url=base_url, timeout=30)

    def __call__(self, method, url, token=None, body=None, headers=None):
        headers = {**(headers or {}), **({"Authorization": f"Bearer {token}"} if token else {})}
        r = self.http.request(method, url, json=body, headers=headers)
        r.data = r.json() if r.headers.get("content-type", "").startswith("application/json") else r.text
        return r

    def login(self, email):
        return self("POST", "/api/auth/login", body={"email": email, "password": "Password123!"}).data["token"]


@pytest.fixture(scope="session")
def api(base_url):
    return Api(base_url)


@pytest.fixture(scope="session")
def tokens(api):
    return {name: api.login(f"{name}@festpass.com") for name in USERS}
