import os
import time
import threading
import requests
from pathlib import Path

from playwright.sync_api import sync_playwright

import horusmapper


ROOT = Path(__file__).resolve().parents[2]


def run_server_in_thread(cfg_path=None):
    # Ensure testing mode enabled
    os.environ['CHASEMAPPER_TESTING'] = '1'
    if cfg_path is None:
        cfg_path = str(ROOT / 'horusmapper.cfg.example')

    # Initialise services but do not block - start socketio in a background thread.
    horusmapper.start_services(cfg_path, start_listeners_flag=True, start_predictor_flag=False)

    app, socketio = horusmapper.create_app()

    def _serve():
        # Use flask host/port from config if present
        host = horusmapper.chasemapper_config.get('flask_host', '127.0.0.1')
        port = int(horusmapper.chasemapper_config.get('flask_port', 5001))
        try:
            socketio.run(app, host=host, port=port, allow_unsafe_werkzeug=True)
        except Exception:
            pass

    t = threading.Thread(target=_serve, daemon=True)
    t.start()
    # Give server time to start
    time.sleep(1.0)
    return t


def test_aprs_add_remove_flow():
    # Start server in testing mode (in-process)
    thread = run_server_in_thread()
    try:
        url = 'http://127.0.0.1:5001/'
        # Wait until server responds to a simple request
        for _ in range(30):
            try:
                r = requests.get(url, timeout=0.5)
                if r.status_code == 200:
                    break
            except Exception:
                time.sleep(0.2)

        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.goto(url)

            # Open APRS panel
            page.click('#topbarAprsBtn')

            # Add a test callsign
            page.fill('[data-test="aprs-input"]', 'TEST1')
            page.click('[data-test="aprs-add-btn"]')

            # Wait for the list item to appear
            page.wait_for_selector('[data-test="aprs-item-TEST1"]', timeout=3000)

            # Now remove it via UI
            page.click('[data-test="aprs-remove-TEST1"]')

            # Assert it is removed
            try:
                page.wait_for_selector('[data-test="aprs-item-TEST1"]', timeout=2000)
                exists = True
            except Exception:
                exists = False

            assert not exists, 'APRS item was not removed by the UI remove action'

            browser.close()
    finally:
        # Attempt to stop background services by clearing running flags
        try:
            horusmapper.data_monitor_thread_running = False
        except Exception:
            pass
