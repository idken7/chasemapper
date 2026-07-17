#!/usr/bin/env python3
"""
Manual/interactive dev tool: start horusmapper in-process and check that it
responds over HTTP.

This is NOT part of the automated test suite - it binds a real port and
starts background services. The fast, non-flaky checks that used to live
alongside this (APRS override sanitization, JS cache-function presence) are
now real pytest tests in tests/unit/test_refactoring_checks.py.

Usage:
    RUN_SERVER_TEST=1 python3 tools/manual_refactoring_smoke_check.py
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import horusmapper


def start_server():
    """Start the server in test mode."""
    os.environ["CHASEMAPPER_TESTING"] = "1"
    horusmapper.start_flask_server_thread()
    time.sleep(2)  # Wait for server to start


def check_server_responds():
    """Check that the server responds to basic requests."""
    import requests

    port = horusmapper.chasemapper_config["flask_port"]
    url = f"http://127.0.0.1:{port}/"

    try:
        response = requests.get(url, timeout=5)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        print("✓ Server responds to basic request")
        return True
    except Exception as e:
        print(f"✗ Server request failed: {e}")
        return False


if __name__ == "__main__":
    if not os.environ.get("RUN_SERVER_TEST"):
        print("Set RUN_SERVER_TEST=1 to run this smoke check (it binds a real port).")
        sys.exit(0)

    start_server()
    ok = check_server_responds()
    sys.exit(0 if ok else 1)
