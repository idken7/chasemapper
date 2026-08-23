"""
Integration test asserting that the `predictor_update` Socket.IO event
includes the `pred_inputs` (ascent rate / descent rate / burst altitude /
launch position & time) and `wind_profile` fields added for the predictor
details + wind profile panel, when the offline (local GFS) predictor path
runs.

Exercises `horusmapper.run_prediction()` directly against a fake payload
track, with the offline `predictor` object and `get_wind_profile` mocked out
so no real GFS data or `cusfpredict` binary is required.
"""
import time

import pytest

import horusmapper
from chasemapper.geometry import GenericTrack


class FakeOfflinePredictor:
    def predict(self, **kwargs):
        now = int(time.time())
        return [
            [now, -34.9499, 138.5194, 0.0],
            [now + 3600, -34.8, 138.6, 30000.0],
            [now + 7200, -34.7, 138.7, 0.0],
        ]


@pytest.fixture
def offline_prediction_state(monkeypatch):
    """Wire up just enough of horusmapper's module-level state to exercise
    run_prediction() for a single payload in offline-predictor mode."""
    payload = "TESTBALLOON"

    monkeypatch.setattr(
        horusmapper,
        "chasemapper_config",
        {
            "pred_enabled": True,
            "offline_predictions": True,
            "pred_burst": 30000,
            "pred_desc_rate": 6.0,
            "show_abort": False,
            "aprs_callsigns": [],
            "aprs_prediction_overrides": {},
        },
    )
    monkeypatch.setattr(horusmapper, "pred_settings", {"gfs_path": "/fake/gfs/path"})
    monkeypatch.setattr(horusmapper, "predictor", FakeOfflinePredictor())

    fake_wind_profile = [
        {"altitude_m": 100.0, "pressure_hpa": 1000.0, "speed_ms": 5.0, "direction_deg": 270.0},
        {"altitude_m": 5000.0, "pressure_hpa": 500.0, "speed_ms": 20.0, "direction_deg": 250.0},
    ]
    monkeypatch.setattr(horusmapper, "get_wind_profile", lambda *a, **kw: fake_wind_profile)

    track = GenericTrack()
    track.add_telemetry({"time": time.time() - 10, "lat": -34.9499, "lon": 138.5194, "alt": 100.0})
    track.add_telemetry({"time": time.time(), "lat": -34.95, "lon": 138.52, "alt": 200.0})

    monkeypatch.setattr(horusmapper, "current_payload_tracks", {payload: track})
    monkeypatch.setattr(
        horusmapper,
        "current_payloads",
        {
            payload: {
                "telem": {"server_time": time.time()},
                "pred_path": [],
                "pred_landing": [],
                "burst": [],
                "abort_path": [],
                "abort_landing": [],
                "pred_inputs": {},
                "wind_profile": [],
            }
        },
    )

    emitted_events = []
    monkeypatch.setattr(
        horusmapper, "flask_emit_event", lambda name, data: emitted_events.append((name, data))
    )

    return payload, emitted_events, fake_wind_profile


def test_predictor_update_includes_pred_inputs_and_wind_profile(offline_prediction_state):
    payload, emitted_events, fake_wind_profile = offline_prediction_state

    horusmapper.run_prediction()

    predictor_updates = [data for (name, data) in emitted_events if name == "predictor_update"]
    assert len(predictor_updates) == 1

    client_data = predictor_updates[0]
    assert client_data["callsign"] == payload

    assert client_data["wind_profile"] == fake_wind_profile

    pred_inputs = client_data["pred_inputs"]
    assert pred_inputs["descent_rate"] == 6.0
    assert pred_inputs["burst_altitude"] == 30000
    assert pred_inputs["launch_lat"] == pytest.approx(-34.95)
    assert pred_inputs["launch_lon"] == pytest.approx(138.52)
    assert "launch_time" in pred_inputs


def test_predictor_update_wind_profile_empty_when_tawhiri_mode(offline_prediction_state, monkeypatch):
    payload, emitted_events, _fake_wind_profile = offline_prediction_state

    # Switch to online (Tawhiri) mode - wind data must never be shown here.
    monkeypatch.setattr(horusmapper, "predictor", "Tawhiri")

    def fake_tawhiri_prediction(**kwargs):
        now = int(time.time())
        return {
            "path": [
                [now, -34.9499, 138.5194, 0.0],
                [now + 3600, -34.8, 138.6, 30000.0],
                [now + 7200, -34.7, 138.7, 0.0],
            ],
            "dataset": "2026010100z",
        }

    monkeypatch.setattr(horusmapper, "get_tawhiri_prediction", fake_tawhiri_prediction)

    horusmapper.run_prediction()

    predictor_updates = [data for (name, data) in emitted_events if name == "predictor_update"]
    assert len(predictor_updates) == 1
    assert predictor_updates[0]["wind_profile"] == []
