"""
Regression checks for the performance/reliability refactor (see
REFACTORING.md): APRS prediction-override sanitization and the JS DOM-query
cache helpers referenced from settings.js.

Originally a standalone script (test_refactoring.py) whose functions caught
their own assertion failures and returned True/False instead of letting
pytest see them - meaning a real regression could still show up as a pytest
PASS. Rewritten here as ordinary asserting tests. The "does the server
respond over HTTP" check from the original script needs a live server/socket
and isn't suited to a fast unit test; that behavior is covered by the
app.test_client()-based tests in tests/integration/test_api_routes.py, and a
minimal live-server smoke check remains available manually via
`RUN_SERVER_TEST=1 python3 tools/manual_refactoring_smoke_check.py`.
"""
import os
from pathlib import Path

import horusmapper

ROOT = Path(__file__).resolve().parents[2]


def test_aprs_prediction_overrides_sidecar_path_resolves():
    config_path = horusmapper.chasemapper_config.get(
        "config_filename", "horusmapper.cfg/horusmapper.cfg"
    )
    sidecar_dir = horusmapper._config_base_dir(config_path)
    sidecar_path = os.path.join(sidecar_dir, "aprs_prediction_overrides.json")
    assert sidecar_path.endswith("aprs_prediction_overrides.json")


def test_aprs_prediction_overrides_sanitization():
    test_data = {
        "CALLSIGN1": {"pred_burst": 28000, "pred_desc_rate": 6.0},
        "CALLSIGN2": {"pred_burst": 30000},
    }
    sanitized = horusmapper._sanitize_aprs_prediction_overrides(test_data)

    assert "CALLSIGN1" in sanitized
    assert sanitized["CALLSIGN1"]["pred_burst"] == 28000
    assert sanitized["CALLSIGN1"]["pred_desc_rate"] == 6.0
    assert sanitized["CALLSIGN2"]["pred_burst"] == 30000


def test_aprs_prediction_overrides_sanitization_drops_invalid_entries():
    test_data = {
        "": {"pred_burst": 1000},  # empty callsign - dropped
        "GOOD": "not-a-dict",  # non-dict values - dropped
        "OK": {"pred_burst": "not-a-number"},  # unparseable field - dropped
    }
    sanitized = horusmapper._sanitize_aprs_prediction_overrides(test_data)
    assert sanitized == {}


def test_javascript_dom_cache_functions_defined():
    settings_js_path = ROOT / "static" / "js" / "settings.js"
    content = settings_js_path.read_text()

    required_functions = [
        "getAprsListElement",
        "getAprsPredictionModal",
        "getAprsStatusDotElement",
    ]
    missing = [fn for fn in required_functions if f"function {fn}" not in content]
    assert not missing, f"Missing expected cache functions in settings.js: {missing}"
