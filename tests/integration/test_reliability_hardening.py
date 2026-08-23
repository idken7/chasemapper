"""
Integration tests for a round of field-reliability fixes to horusmapper.py:

  - The chase-car ownership lease's grace-period timeout (a reconnecting
    browser, after a network drop, must be able to reclaim its client_id
    without waiting for Socket.IO's own ping-timeout).
  - current_payloads[callsign]["path"] being capped so a multi-hour flight
    doesn't grow it without bound.
  - predictorThread() surviving an exception raised inside a single
    prediction cycle instead of dying permanently.
  - The rate-limit bucket sweep actually being able to find and remove an
    abandoned bucket (a bucket's deque is never literally empty once
    populated - see the sweep implementation for why "not v" alone can't
    detect staleness).

Mirrors the fixture/reset conventions of test_multi_user_and_security.py and
test_api_routes.py - see those files for why each piece of shared
module-level state needs resetting between tests.
"""
import time

import pytest

import horusmapper
from chasemapper.geometry import GenericTrack


@pytest.fixture(autouse=True)
def _reset_state(monkeypatch):
    monkeypatch.setenv("CHASEMAPPER_TESTING", "1")
    monkeypatch.delenv("CHASEMAPPER_REQUIRE_API_AUTH", raising=False)
    monkeypatch.delenv("CHASEMAPPER_API_KEY", raising=False)

    with horusmapper.client_car_owners_lock:
        horusmapper.client_car_owners.clear()
        horusmapper.client_car_owners_by_sid.clear()
    with horusmapper.api_rate_limit_lock:
        horusmapper.api_rate_limit_buckets.clear()
    horusmapper.chasemapper_config.setdefault("ascent_rate_averaging", 6)
    horusmapper.chasemapper_config.setdefault("pred_enabled", False)

    _prev_predictor_running = horusmapper.predictor_thread_running
    _prev_pred_update_rate = horusmapper.chasemapper_config.get("pred_update_rate")

    yield

    horusmapper.predictor_thread_running = _prev_predictor_running
    if _prev_pred_update_rate is None:
        horusmapper.chasemapper_config.pop("pred_update_rate", None)
    else:
        horusmapper.chasemapper_config["pred_update_rate"] = _prev_pred_update_rate

    with horusmapper.client_car_owners_lock:
        horusmapper.client_car_owners.clear()
        horusmapper.client_car_owners_by_sid.clear()
    with horusmapper.api_rate_limit_lock:
        horusmapper.api_rate_limit_buckets.clear()
    horusmapper.current_payloads.clear()
    horusmapper.current_payload_tracks.clear()


@pytest.fixture
def app_client():
    app, _socketio = horusmapper.create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


def _sio_client(app_client, query_string=None):
    return horusmapper.socketio.test_client(
        horusmapper.app,
        namespace="/chasemapper",
        query_string=query_string,
        flask_test_client=app_client,
    )


def _position(lat, lon, client_id, alt=250.0):
    return {"latitude": lat, "longitude": lon, "altitude": alt, "client_id": client_id}


# ---------------------------------------------------------------------------
# Ownership lease grace-period timeout.
# ---------------------------------------------------------------------------


class _FakeMonotonicClock:
    """A controllable stand-in for time.monotonic(), advanced explicitly by
    the test rather than by real elapsed wall-clock time."""

    def __init__(self, start=1000.0):
        self._now = start

    def advance(self, seconds):
        self._now += seconds

    def __call__(self):
        return self._now


def test_reconnecting_client_reclaims_ownership_after_owner_goes_quiet(app_client, monkeypatch):
    clock = _FakeMonotonicClock()
    monkeypatch.setattr(horusmapper.time, "monotonic", clock)

    owner = _sio_client(app_client)
    impostor = _sio_client(app_client)
    try:
        owner.emit("device_position", _position(1.0, 1.0, "carX"), namespace="/chasemapper")

        # Still well within the grace period - a different sid must still be
        # rejected (this is the anti-spoofing behaviour the lease exists for
        # in the first place; it must not have been weakened).
        clock.advance(5.0)
        impostor.emit("device_position", _position(99.0, 99.0, "carX"), namespace="/chasemapper")
        state = horusmapper.client_car_tracks["carX"]["track"].get_latest_state()
        assert (state["lat"], state["lon"]) == (1.0, 1.0)

        # The owner goes quiet (a plausible network drop) for longer than the
        # grace period without ever sending an explicit disconnect. A newly
        # (re)connecting sid claiming the same client_id must now succeed -
        # this is the actual fix: previously it stayed locked out until
        # Socket.IO's own ping-timeout (tens of seconds) elapsed.
        clock.advance(horusmapper.CLIENT_CAR_OWNERSHIP_GRACE_S + 1.0)
        new_owner = _sio_client(app_client)
        try:
            new_owner.emit("device_position", _position(5.0, 5.0, "carX"), namespace="/chasemapper")
            state = horusmapper.client_car_tracks["carX"]["track"].get_latest_state()
            assert (state["lat"], state["lon"]) == (5.0, 5.0)

            # Ownership fully transferred, not merely "also allowed": the old
            # sid can no longer act as carX either.
            owner.emit("device_position", _position(2.0, 2.0, "carX"), namespace="/chasemapper")
            state = horusmapper.client_car_tracks["carX"]["track"].get_latest_state()
            assert (state["lat"], state["lon"]) == (5.0, 5.0)
        finally:
            new_owner.disconnect(namespace="/chasemapper")
    finally:
        owner.disconnect(namespace="/chasemapper")
        impostor.disconnect(namespace="/chasemapper")


def test_ownership_lease_renews_so_an_active_owner_is_never_treated_as_stale(app_client, monkeypatch):
    clock = _FakeMonotonicClock()
    monkeypatch.setattr(horusmapper.time, "monotonic", clock)

    owner = _sio_client(app_client)
    impostor = _sio_client(app_client)
    try:
        owner.emit("device_position", _position(1.0, 1.0, "carY"), namespace="/chasemapper")

        # Owner keeps renewing just under the grace window on every update -
        # total elapsed time since the *first* claim ends up well past the
        # grace period, but the owner is actively renewing throughout and
        # must never be treated as gone quiet.
        for _ in range(3):
            clock.advance(horusmapper.CLIENT_CAR_OWNERSHIP_GRACE_S - 1.0)
            owner.emit("device_position", _position(2.0, 2.0, "carY"), namespace="/chasemapper")

        impostor.emit("device_position", _position(99.0, 99.0, "carY"), namespace="/chasemapper")
        state = horusmapper.client_car_tracks["carY"]["track"].get_latest_state()
        assert (state["lat"], state["lon"]) == (2.0, 2.0)
    finally:
        owner.disconnect(namespace="/chasemapper")
        impostor.disconnect(namespace="/chasemapper")


# ---------------------------------------------------------------------------
# current_payloads[callsign]["path"] cap.
# ---------------------------------------------------------------------------


def test_handle_new_payload_position_caps_path_length(monkeypatch):
    from datetime import datetime, timezone

    monkeypatch.setattr(horusmapper, "MAX_TELEMETRY_PATH_POINTS", 5)
    callsign = "PATHCAP_TEST"
    try:
        for i in range(10):
            horusmapper.handle_new_payload_position(
                {
                    "callsign": callsign,
                    "lat": 1.0,
                    "lon": 2.0,
                    "alt": float(i),
                    "time_dt": datetime.now(timezone.utc),
                },
                log_position=False,
            )

        path = horusmapper.current_payloads[callsign]["path"]
        assert len(path) == 5
        # Oldest points dropped, not newest.
        assert [p[2] for p in path] == [5.0, 6.0, 7.0, 8.0, 9.0]
    finally:
        horusmapper.current_payloads.pop(callsign, None)
        horusmapper.current_payload_tracks.pop(callsign, None)


def test_handle_new_payload_position_path_uncapped_below_threshold():
    from datetime import datetime, timezone

    callsign = "PATHCAP_TEST_SMALL"
    try:
        for i in range(20):
            horusmapper.handle_new_payload_position(
                {
                    "callsign": callsign,
                    "lat": 1.0,
                    "lon": 2.0,
                    "alt": float(i),
                    "time_dt": datetime.now(timezone.utc),
                },
                log_position=False,
            )
        assert len(horusmapper.current_payloads[callsign]["path"]) == 20
    finally:
        horusmapper.current_payloads.pop(callsign, None)
        horusmapper.current_payload_tracks.pop(callsign, None)


# ---------------------------------------------------------------------------
# predictorThread() exception resilience.
# ---------------------------------------------------------------------------


def test_predictor_thread_survives_exception_in_run_prediction(monkeypatch):
    call_count = {"n": 0}

    def _boom():
        call_count["n"] += 1
        raise RuntimeError("simulated prediction crash")

    monkeypatch.setattr(horusmapper, "run_prediction", _boom)
    horusmapper.chasemapper_config["pred_update_rate"] = 1
    horusmapper.predictor_thread_running = True

    def _sleep_and_stop(_seconds):
        # Runs after the (crashing) prediction cycle completes - stopping the
        # flag here proves run_prediction()'s exception didn't propagate out
        # of the loop (if it had, this line would never be reached).
        horusmapper.predictor_thread_running = False

    monkeypatch.setattr(horusmapper.time, "sleep", _sleep_and_stop)

    horusmapper.predictorThread()  # must return normally, not raise

    assert call_count["n"] == 1


def test_predictor_thread_keeps_calling_run_prediction_each_cycle_despite_crashes(monkeypatch):
    call_count = {"n": 0}

    def _boom():
        call_count["n"] += 1
        if call_count["n"] >= 3:
            horusmapper.predictor_thread_running = False
        raise RuntimeError("simulated prediction crash")

    monkeypatch.setattr(horusmapper, "run_prediction", _boom)
    horusmapper.chasemapper_config["pred_update_rate"] = 1
    horusmapper.predictor_thread_running = True
    monkeypatch.setattr(horusmapper.time, "sleep", lambda _s: None)

    horusmapper.predictorThread()

    assert call_count["n"] == 3


# ---------------------------------------------------------------------------
# Rate-limit bucket staleness sweep.
# ---------------------------------------------------------------------------


def test_rate_limit_sweep_evicts_a_genuinely_abandoned_bucket(monkeypatch):
    # A bucket's deque is never left empty by _consume_rate_limit (the trim
    # step is always immediately followed by either an append or a refusal
    # that leaves entries behind) - so the sweep has to identify staleness by
    # the bucket's most recent timestamp being old, not by emptiness.
    monkeypatch.setattr(horusmapper, "_RATE_LIMIT_SWEEP_INTERVAL", 2)
    monkeypatch.setattr(horusmapper, "_RATE_LIMIT_BUCKET_STALE_S", 100)

    fake_now = {"t": 1_000_000.0}
    monkeypatch.setattr(horusmapper.time, "time", lambda: fake_now["t"])

    ok, _ = horusmapper._consume_rate_limit("1.2.3.4", "abandoned", limit=100, window_s=60)
    assert ok
    assert "1.2.3.4:abandoned" in horusmapper.api_rate_limit_buckets

    # Move far enough forward that the abandoned bucket's last entry is
    # older than _RATE_LIMIT_BUCKET_STALE_S, then make enough *other* calls
    # to cross the sweep interval (the abandoned bucket itself is never
    # touched again - that's the point).
    fake_now["t"] += 200
    horusmapper._consume_rate_limit("5.6.7.8", "other-1", limit=100, window_s=60)
    horusmapper._consume_rate_limit("5.6.7.9", "other-2", limit=100, window_s=60)

    assert "1.2.3.4:abandoned" not in horusmapper.api_rate_limit_buckets
    # The buckets touched during/after the sweep must survive it.
    assert "5.6.7.8:other-1" in horusmapper.api_rate_limit_buckets
    assert "5.6.7.9:other-2" in horusmapper.api_rate_limit_buckets


def test_rate_limit_sweep_leaves_recently_active_buckets_alone(monkeypatch):
    monkeypatch.setattr(horusmapper, "_RATE_LIMIT_SWEEP_INTERVAL", 2)
    monkeypatch.setattr(horusmapper, "_RATE_LIMIT_BUCKET_STALE_S", 100)

    fake_now = {"t": 1_000_000.0}
    monkeypatch.setattr(horusmapper.time, "time", lambda: fake_now["t"])

    horusmapper._consume_rate_limit("9.9.9.9", "active", limit=100, window_s=60)
    fake_now["t"] += 10  # well under the 100s staleness threshold
    horusmapper._consume_rate_limit("1.1.1.1", "trigger-sweep", limit=100, window_s=60)

    assert "9.9.9.9:active" in horusmapper.api_rate_limit_buckets
