import os
import sys
import time
import threading
import requests
import socket
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

import horusmapper


def run_server_in_thread(cfg_path=None):
    # Ensure testing mode enabled
    os.environ['CHASEMAPPER_TESTING'] = '1'
    if cfg_path is None:
        cfg_path = str(ROOT / 'horusmapper.cfg.example')

    # Initialise services but do not block - start socketio in a background thread.
    # During tests we disable background listeners (serial/APRS/etc.) to avoid
    # hardware access and port conflicts.
    horusmapper.start_services(cfg_path, start_listeners_flag=False, start_predictor_flag=False)

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]

    horusmapper.chasemapper_config['flask_port'] = port

    app, socketio = horusmapper.create_app()

    def _serve():
        # Use flask host/port from config if present
        host = horusmapper.chasemapper_config.get('flask_host', '127.0.0.1')
        port = int(horusmapper.chasemapper_config.get('flask_port', 5001))
        socketio.run(app, host=host, port=port, allow_unsafe_werkzeug=True)

    t = threading.Thread(target=_serve, daemon=True)
    t.start()
    # Give server time to start
    time.sleep(1.0)
    return t


def test_aprs_add_remove_flow():
    # Start server in testing mode (in-process)
    run_server_in_thread()
    try:
        config = horusmapper.chasemapper_config
        assert config is not None

        config['pred_model'] = 'GFS'
        config['pred_model_time'] = '01/02/2024, 03:04:05 UTC'
        url = 'http://127.0.0.1:%d/' % config['flask_port']
        # Wait until server responds to a simple request
        for _ in range(30):
            try:
                r = requests.get(url, timeout=0.5)
                if r.status_code == 200:
                    break
            except requests.RequestException:
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

            # Recheck layout at a narrow width to catch button overflow regressions.
            page.set_viewport_size({"width": 360, "height": 900})
            assert page.evaluate("""
                () => {
                    const item = document.querySelector('[data-test="aprs-item-TEST1"]');
                    const actions = item && item.querySelector('.aprs-actions');
                    if (!item || !actions) {
                        return false;
                    }
                    return actions.scrollWidth <= actions.clientWidth && item.scrollWidth <= item.clientWidth;
                }
            """) is True

            # The prediction cadence setting should be visible in the menuDock settings panel.
            assert page.locator('#predUpdateRate').count() == 1
            assert page.locator('#predUpdateRate').input_value() == '15'
            assert page.locator('#predictorModelValue').count() == 1
            assert (page.locator('#predictorModelValue').text_content() or '').strip() == 'GFS'
            assert (page.locator('#predictorModelTimeValue').text_content() or '').strip() == '01/02/2024, 03:04:05 UTC'

            # The top-right 3D view control should toggle the actual map container.
            page.click('#toggle3DButton')
            assert page.locator('#map').evaluate("el => el.classList.contains('map-3d-view')") is True
            assert page.locator('#toggle3DButton').evaluate("el => el.classList.contains('is-active')") is True

            # The Cesium marker interaction should reveal the camera-angle slider.
            page.evaluate("window.showCesiumCameraSlider && window.showCesiumCameraSlider('TEST1')")
            assert page.locator('#cesiumCameraSliderPanel').evaluate("el => el.classList.contains('is-open')") is True
            assert page.locator('#cesiumCameraSliderTitle').text_content() == 'Camera angle: TEST1'
            page.evaluate("window.setCesiumCameraPitch && window.setCesiumCameraPitch(-25)")
            assert (page.locator('#cesiumCameraSliderValue').text_content() or '').strip() == '-25°'
            assert page.evaluate("window.getCesiumCameraState && window.getCesiumCameraState().pitch") == -25

            page.click('#toggle3DButton')
            assert page.locator('#map').evaluate("el => el.classList.contains('map-3d-view')") is False

            # Regression: refreshing an existing APRS balloon entry without prediction
            # data must not drop the prior prediction layer.
            page.evaluate("""
                () => {
                    const callsign = 'TEST1';
                    const baseData = {
                        telem: {
                            callsign,
                            position: [42.0, -83.0, 1000],
                            vel_v: 5.0,
                            speed: 10.0,
                            max_alt: 1000,
                            short_time: '12:00:00',
                            packet_time: new Date().toISOString(),
                            server_time: Date.now() / 1000
                        },
                        path: [[42.0, -83.0, 1000]],
                        pred_path: [[42.0, -83.0, 1000], [43.0, -84.0, 0]],
                        pred_landing: [43.0, -84.0, 0],
                        burst: [],
                        abort_path: [],
                        abort_landing: []
                    };

                    add_new_balloon(baseData);
                    window.__aprsPredictionLayer = balloon_positions[callsign].pred_path;
                    window.__aprsPredictionLatLngCount = balloon_positions[callsign].pred_path.getLatLngs().length;

                    add_new_balloon({
                        telem: Object.assign({}, baseData.telem, {position: [42.1, -83.1, 1100]}),
                        path: [[42.1, -83.1, 1100]],
                        pred_path: [],
                        pred_landing: [],
                        burst: [],
                        abort_path: [],
                        abort_landing: []
                    });

                    window.__aprsPredictionLayerPreserved = balloon_positions[callsign].pred_path === window.__aprsPredictionLayer;
                    window.__aprsPredictionLayerStillVisible = map.hasLayer(window.__aprsPredictionLayer);
                    window.__aprsPredictionLatLngCountAfter = balloon_positions[callsign].pred_path.getLatLngs().length;
                }
            """)

            # Open the per-callsign summary view and verify enriched fields are shown.
            page.click('[data-test="aprs-view-TEST1"]')
            page.wait_for_selector('#aprsCallsignModal.is-open', timeout=3000)
            assert page.locator('#aprsCallsignModalTitle').text_content() == 'Callsign Summary: TEST1'
            assert '43.00000, -84.00000' in (page.locator('#aprsCallsignSummaryLanding').text_content() or '')
            assert (page.locator('#aprsCallsignSummaryPredPoints').text_content() or '').strip() == '2'
            pred_age_text = (page.locator('#aprsCallsignSummaryPredAge').text_content() or '').strip()
            assert pred_age_text == '—' or pred_age_text.endswith('s')
            page.click('#aprsCallsignModal .recovery-modal-footer .btn.btn-secondary')
            page.wait_for_selector('#aprsCallsignModal', state='hidden', timeout=3000)

            assert page.evaluate("window.__aprsPredictionLayerPreserved") is True
            assert page.evaluate("window.__aprsPredictionLayerStillVisible") is True
            assert page.evaluate("window.__aprsPredictionLatLngCount") == page.evaluate("window.__aprsPredictionLatLngCountAfter")

            # Open per-callsign prediction settings.
            page.click('[data-test="aprs-settings-TEST1"]')
            page.wait_for_selector('#aprsPredictionModal.is-open', timeout=3000)
            assert page.locator('#aprsPredictionModalTitle').text_content() == 'Prediction Settings for TEST1'

            # Change the settings and save them.
            page.fill('#aprsPredictionBurstAlt', '29000')
            page.fill('#aprsPredictionDescentRate', '5.5')
            page.click('#aprsPredictionModalSubmitBtn')

            page.wait_for_selector('#aprsPredictionModal', state='hidden', timeout=3000)
            assert config['aprs_prediction_overrides']['TEST1']['pred_burst'] == 29000.0
            assert config['aprs_prediction_overrides']['TEST1']['pred_desc_rate'] == 5.5

            # Now remove it via UI while the APRS view is still active.
            page.click('[data-test="aprs-remove-TEST1"]')

            # Assert it is removed.
            page.wait_for_function("() => document.querySelector('[data-test=\"aprs-item-TEST1\"]') === null", timeout=2000)

            # Switch into the Settings view and confirm the interval rows reuse the same
            # recovery-style row structure as the prediction modal fields.
            page.evaluate("toggleSettingsPanel('settings')")
            page.wait_for_selector('#otherSection:visible', timeout=3000)
            assert page.evaluate("""
                () => {
                    const predRow = document.querySelector('#predUpdateRate')?.closest('.recovery-input-row');
                    const aprsRow = document.querySelector('#aprsPollInterval')?.closest('.recovery-input-row');
                    const predUnits = document.querySelector('#predUpdateRate')?.closest('.recovery-input-row')?.querySelector('.recovery-input-units');
                    const aprsUnits = document.querySelector('#aprsPollInterval')?.closest('.recovery-input-row')?.querySelector('.recovery-input-units');
                    return !!predRow && !!aprsRow && !!predUnits && !!aprsUnits;
                }
            """) is True

            page.click('[data-test="clear-payload"]')
            page.wait_for_selector('#destructiveConfirmModal.is-open', timeout=3000)
            assert page.locator('#destructiveConfirmModalTitle').text_content() == 'Clear Payload Data'
            page.click('#destructiveConfirmModalCancelBtn')
            page.wait_for_selector('#destructiveConfirmModal', state='hidden', timeout=3000)

            page.click('[data-test="clear-car"]')
            page.wait_for_selector('#destructiveConfirmModal.is-open', timeout=3000)
            assert page.locator('#destructiveConfirmModalTitle').text_content() == 'Clear Chase-Car Track'
            page.click('#destructiveConfirmModalSubmitBtn')
            page.wait_for_selector('#destructiveConfirmModal', state='hidden', timeout=3000)

            browser.close()
    finally:
        # Attempt to stop background services by clearing running flags
        horusmapper.data_monitor_thread_running = False
