import pytest
from datetime import datetime, timezone, timedelta
from chasemapper.geometry import GenericTrack


def test_generictrack_add_telemetry_and_states():
    gt = GenericTrack()

    t0 = datetime.now(timezone.utc)
    gt.add_telemetry({"time": t0, "lat": 0.0, "lon": 0.0, "alt": 0.0})
    assert gt.length() == 1

    poly = gt.to_polyline()
    # Single point is duplicated into two for polyline output
    assert isinstance(poly, list)
    assert len(poly) == 2

    # Add a second point 10 seconds later with a small lon change and 10m ascent
    t1 = t0 + timedelta(seconds=10)
    gt.add_telemetry({"time": t1, "lat": 0.0, "lon": 0.001, "alt": 10.0})
    assert gt.length() == 2

    state = gt.get_latest_state()
    # Ascent rate should be approx 1.0 m/s (10 m / 10 s)
    assert pytest.approx(state["ascent_rate"], rel=1e-3) == 1.0
    # Speed should be > 0 for the lon change
    assert state["speed"] > 0.0
    # Heading should be present and numeric
    assert isinstance(state["heading"], float)
