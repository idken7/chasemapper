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


def test_generictrack_caps_track_history(monkeypatch):
    # A multi-hour (or multi-day) session must not grow track_history without
    # bound. Use a small cap so the test stays fast rather than actually
    # appending MAX_TRACK_HISTORY (20000) points.
    monkeypatch.setattr(GenericTrack, "MAX_TRACK_HISTORY", 5)
    gt = GenericTrack()
    t0 = datetime.now(timezone.utc)

    for i in range(10):
        gt.add_telemetry({"time": t0 + timedelta(seconds=i), "lat": 0.0, "lon": 0.0, "alt": float(i)})

    assert len(gt.track_history) == 5
    # Oldest points are dropped, not newest - the 5 most recently added
    # (alt 5..9) must be exactly what's retained, in order.
    assert [point[3] for point in gt.track_history] == [5.0, 6.0, 7.0, 8.0, 9.0]

    # Ascent-rate/heading/etc calculations all index track_history relative to
    # the *end* of the list (-1, -2, ...) - confirm they still work correctly
    # after trimming rather than raising or silently misbehaving.
    state = gt.get_latest_state()
    assert state is not None
    assert pytest.approx(state["ascent_rate"], rel=1e-3) == 1.0

    poly = gt.to_polyline()
    assert len(poly) == 5


def test_generictrack_track_history_uncapped_below_threshold():
    # Sanity check the cap doesn't kick in prematurely and truncate a normal,
    # short-lived track.
    gt = GenericTrack()
    t0 = datetime.now(timezone.utc)
    for i in range(50):
        gt.add_telemetry({"time": t0 + timedelta(seconds=i), "lat": 0.0, "lon": 0.0, "alt": float(i)})
    assert len(gt.track_history) == 50
