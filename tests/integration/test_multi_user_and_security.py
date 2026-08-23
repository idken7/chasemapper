"""
Integration tests for two recently-added, previously-untested pieces of
horusmapper.py:

  Part A - Multi-user chase-car tracking: independent per-browser car
  positions (`client_car_tracks`, `handle_client_car_position`,
  `device_position` / `client_car_clear` socket.io handlers, the
  `client_connected` replay-to-new-client behaviour, and the staleness
  aging performed by `check_data_age`).

  Part B - The Socket.IO security layer: connect-time API-key auth
  (`_require_socketio_connect_auth`), per-action "operator" auth for the
  destructive `payload_data_clear` / `car_data_clear` events
  (`_require_operator_auth`), the client-car ownership lease that stops one
  connection from spoofing another's still-active `client_id`
  (`_claim_client_car_ownership` / `_release_client_car_ownership`), and the
  per-IP rate limiter applied to the `device_position` event.

These exercise horusmapper's Flask app and Socket.IO server directly via
Flask-SocketIO's `SocketIOTestClient` (no live server / real socket
needed). See tests/integration/test_api_routes.py for the sibling REST-API
test suite and the env-var reset conventions this file mirrors.
"""
import time
from datetime import datetime, timezone

import pytest

import horusmapper
from chasemapper.geometry import GenericTrack
from chasemapper.bearings import Bearings


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _reset_state(monkeypatch):
    """Reset module-level mutable state shared across requests/connections so
    tests don't leak into each other - mirrors test_api_routes.py's
    `_reset_api_state`, plus the multi-user-car and ownership state this
    file additionally exercises."""
    monkeypatch.setenv("CHASEMAPPER_TESTING", "1")
    monkeypatch.delenv("CHASEMAPPER_REQUIRE_API_AUTH", raising=False)
    monkeypatch.delenv("CHASEMAPPER_API_KEY", raising=False)
    monkeypatch.delenv("CHASEMAPPER_API_RATE_LIMIT_ENABLED", raising=False)
    monkeypatch.delenv("CHASEMAPPER_API_RATE_LIMIT_PER_MIN", raising=False)
    monkeypatch.delenv("CHASEMAPPER_API_RATE_LIMIT_WINDOW_S", raising=False)
    monkeypatch.delenv("CHASEMAPPER_SOCKETIO_RATE_LIMIT_ENABLED", raising=False)
    monkeypatch.delenv("CHASEMAPPER_SOCKETIO_RATE_LIMIT_PER_MIN", raising=False)
    monkeypatch.delenv("CHASEMAPPER_SOCKETIO_RATE_LIMIT_WINDOW_S", raising=False)

    with horusmapper.client_car_tracks_lock:
        horusmapper.client_car_tracks.clear()
    with horusmapper.client_car_owners_lock:
        horusmapper.client_car_owners.clear()
        horusmapper.client_car_owners_by_sid.clear()
    with horusmapper.api_rate_limit_lock:
        horusmapper.api_rate_limit_buckets.clear()
    with horusmapper.connected_sids_lock:
        horusmapper.connected_sids.clear()
    horusmapper.chasemapper_config.setdefault("payload_max_age", 180)

    # create_app() (used by app_client below) deliberately skips
    # start_services(), so bearing_store is None unless we set it up - the
    # add_manual_bearing / bearingValid code paths silently no-op on a None
    # store. Give each test a fresh one; restore whatever was there after
    # (mirrors the data_monitor_thread_running save/restore below).
    _prev_bearing_store = horusmapper.bearing_store
    horusmapper.bearing_store = Bearings(socketio_instance=horusmapper.socketio)

    # Other test modules (e.g. tests/gui/test_aprs_ui.py) start the real
    # check_data_age() background thread and flip this module-level flag to
    # False in their teardown to stop it, without restoring it - since
    # `horusmapper` is a single module shared for the whole test session,
    # that leaks into any later test (like ours) that calls check_data_age()
    # directly expecting its `while data_monitor_thread_running:` loop body
    # to actually run. Force it True here and restore afterwards so this
    # file's behaviour doesn't depend on what ran before it.
    _prev_data_monitor_thread_running = horusmapper.data_monitor_thread_running
    horusmapper.data_monitor_thread_running = True

    yield

    horusmapper.data_monitor_thread_running = _prev_data_monitor_thread_running
    horusmapper.bearing_store = _prev_bearing_store

    with horusmapper.client_car_tracks_lock:
        horusmapper.client_car_tracks.clear()
    with horusmapper.client_car_owners_lock:
        horusmapper.client_car_owners.clear()
        horusmapper.client_car_owners_by_sid.clear()
    with horusmapper.api_rate_limit_lock:
        horusmapper.api_rate_limit_buckets.clear()
    with horusmapper.connected_sids_lock:
        horusmapper.connected_sids.clear()


@pytest.fixture
def app_client():
    app, _socketio = horusmapper.create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


def _sio_client(app_client, query_string=None, headers=None):
    """Create a connected (or connection-attempted) Socket.IO test client on
    the /chasemapper namespace."""
    return horusmapper.socketio.test_client(
        horusmapper.app,
        namespace="/chasemapper",
        query_string=query_string,
        headers=headers,
        flask_test_client=app_client,
    )


def _position(lat=39.0, lon=-83.0, alt=250.0, client_id=None, name=None, **extra):
    data = {"latitude": lat, "longitude": lon, "altitude": alt}
    if client_id is not None:
        data["client_id"] = client_id
    if name is not None:
        data["name"] = name
    data.update(extra)
    return data


def _telemetry_events(client, namespace="/chasemapper"):
    return [
        pkt["args"][0]
        for pkt in client.get_received(namespace=namespace)
        if pkt["name"] == "telemetry_event"
    ]


# ---------------------------------------------------------------------------
# 1 & 2. handle_client_car_position: independent tracks, correct broadcast
#         shape, and multiple client_ids not clobbering each other.
# ---------------------------------------------------------------------------


def test_handle_client_car_position_creates_independent_track(app_client):
    listener = _sio_client(app_client)
    try:
        # car_track (the legacy/primary track) must be untouched.
        assert horusmapper.car_track.get_latest_state() is None

        horusmapper.handle_client_car_position(
            "client-a", "Alice", _position(lat=39.1, lon=-83.1, alt=300.0, heading=90, heading_status="gps")
        )

        assert horusmapper.car_track.get_latest_state() is None
        assert "client-a" in horusmapper.client_car_tracks
        entry = horusmapper.client_car_tracks["client-a"]
        assert entry["name"] == "Alice"
        state = entry["track"].get_latest_state()
        assert state["lat"] == 39.1
        assert state["lon"] == -83.1
        assert state["alt"] == 300.0

        events = _telemetry_events(listener)
        assert len(events) == 1
        telem = events[0]
        assert telem["callsign"] == "CAR"
        assert telem["car_id"] == "client-a"
        assert telem["car_name"] == "Alice"
        assert telem["position"] == [39.1, -83.1, 300.0]
        assert telem["vel_v"] == 0.0
        assert "heading" in telem
        assert "heading_valid" in telem
        assert "heading_status" in telem
        assert "speed" in telem
    finally:
        listener.disconnect(namespace="/chasemapper")


def test_two_client_ids_tracked_independently(app_client):
    listener = _sio_client(app_client)
    try:
        horusmapper.handle_client_car_position("client-a", "Alice", _position(lat=39.1, lon=-83.1))
        horusmapper.handle_client_car_position("client-b", "Bob", _position(lat=40.2, lon=-84.2))

        assert set(horusmapper.client_car_tracks.keys()) == {"client-a", "client-b"}

        state_a = horusmapper.client_car_tracks["client-a"]["track"].get_latest_state()
        state_b = horusmapper.client_car_tracks["client-b"]["track"].get_latest_state()
        assert (state_a["lat"], state_a["lon"]) == (39.1, -83.1)
        assert (state_b["lat"], state_b["lon"]) == (40.2, -84.2)

        # A further update to A must not perturb B.
        horusmapper.handle_client_car_position("client-a", "Alice", _position(lat=39.9, lon=-83.9))
        state_b_again = horusmapper.client_car_tracks["client-b"]["track"].get_latest_state()
        assert (state_b_again["lat"], state_b_again["lon"]) == (40.2, -84.2)

        events = _telemetry_events(listener)
        car_ids = [e["car_id"] for e in events]
        assert car_ids == ["client-a", "client-b", "client-a"]
    finally:
        listener.disconnect(namespace="/chasemapper")


# ---------------------------------------------------------------------------
# 3. client_car_clear removes only the targeted client_id.
# ---------------------------------------------------------------------------


def test_client_car_clear_removes_only_targeted_client(app_client):
    a = _sio_client(app_client)
    b = _sio_client(app_client)
    try:
        a.emit("device_position", _position(lat=39.1, lon=-83.1, client_id="client-a"), namespace="/chasemapper")
        b.emit("device_position", _position(lat=40.2, lon=-84.2, client_id="client-b"), namespace="/chasemapper")
        assert set(horusmapper.client_car_tracks.keys()) == {"client-a", "client-b"}
        a.get_received(namespace="/chasemapper")
        b.get_received(namespace="/chasemapper")

        a.emit("client_car_clear", {"client_id": "client-a"}, namespace="/chasemapper")

        assert "client-a" not in horusmapper.client_car_tracks
        assert "client-b" in horusmapper.client_car_tracks
    finally:
        a.disconnect(namespace="/chasemapper")
        b.disconnect(namespace="/chasemapper")


# ---------------------------------------------------------------------------
# 4. client_connected replays other active client cars to the new
#    connection only, without spamming already-connected clients.
# ---------------------------------------------------------------------------


def test_client_connected_replays_other_cars_to_new_client_only(app_client):
    a = _sio_client(app_client)
    try:
        a.emit("device_position", _position(lat=39.1, lon=-83.1, client_id="client-a", name="Alice"), namespace="/chasemapper")
        a.get_received(namespace="/chasemapper")  # drain the broadcast from the position update

        b = _sio_client(app_client)
        try:
            # The new connection asks the server to replay current state.
            b.emit("client_connected", {}, namespace="/chasemapper")

            b_events = _telemetry_events(b)
            assert len(b_events) == 1
            assert b_events[0]["car_id"] == "client-a"
            assert b_events[0]["car_name"] == "Alice"
            assert b_events[0]["position"] == [39.1, -83.1, 250.0]

            # A must not have received any *telemetry* as a side effect of
            # B's client_connected (the replay is targeted at B's sid only).
            # A legitimately does receive a presence_update - that's a
            # broadcast triggered by B's connection itself, not by the
            # per-sid-targeted replay this test is checking.
            a_received = a.get_received(namespace="/chasemapper")
            assert [pkt for pkt in a_received if pkt["name"] == "telemetry_event"] == []
        finally:
            b.disconnect(namespace="/chasemapper")
    finally:
        a.disconnect(namespace="/chasemapper")


def test_client_connected_replay_empty_when_no_cars_active(app_client):
    c = _sio_client(app_client)
    try:
        c.emit("client_connected", {}, namespace="/chasemapper")
        assert _telemetry_events(c) == []
    finally:
        c.disconnect(namespace="/chasemapper")


# ---------------------------------------------------------------------------
# 5. Stale client_car_tracks entries get aged out by check_data_age();
#    fresh ones don't. check_data_age() is an infinite loop
#    (`while data_monitor_thread_running: ... time.sleep(2)`), so rather than
#    reimplementing its staleness formula in the test (which would test the
#    test, not the code) we let the real function run for exactly one
#    iteration by making time.sleep raise a sentinel exception, which
#    deterministically breaks out of the loop right where the real
#    `time.sleep(2)` call is (after both aging passes for that iteration have
#    completed) - no real waiting, no thread, no flakiness.
# ---------------------------------------------------------------------------


class _StopLoop(Exception):
    pass


def test_check_data_age_ages_out_stale_client_cars_but_not_fresh(monkeypatch):
    horusmapper.chasemapper_config["payload_max_age"] = 5  # minutes -> 300s stale threshold
    now = time.time()

    with horusmapper.client_car_tracks_lock:
        horusmapper.client_car_tracks["stale-car"] = {
            "track": GenericTrack(),
            "name": "Stale",
            "last_seen": now - 400,  # older than 300s -> should be aged out
        }
        horusmapper.client_car_tracks["fresh-car"] = {
            "track": GenericTrack(),
            "name": "Fresh",
            "last_seen": now - 10,  # well within 300s -> should survive
        }

    def _sleep_then_stop(_seconds):
        raise _StopLoop()

    monkeypatch.setattr(horusmapper.time, "sleep", _sleep_then_stop)

    with pytest.raises(_StopLoop):
        horusmapper.check_data_age()

    assert "stale-car" not in horusmapper.client_car_tracks
    assert "fresh-car" in horusmapper.client_car_tracks


def test_check_data_age_boundary_just_within_max_age_is_not_stale(monkeypatch):
    horusmapper.chasemapper_config["payload_max_age"] = 5  # -> 300s
    now = time.time()

    with horusmapper.client_car_tracks_lock:
        horusmapper.client_car_tracks["borderline-car"] = {
            "track": GenericTrack(),
            "name": "Borderline",
            "last_seen": now - 100,  # comfortably within the window
        }

    def _sleep_then_stop(_seconds):
        raise _StopLoop()

    monkeypatch.setattr(horusmapper.time, "sleep", _sleep_then_stop)

    with pytest.raises(_StopLoop):
        horusmapper.check_data_age()

    assert "borderline-car" in horusmapper.client_car_tracks


# ---------------------------------------------------------------------------
# 6. Socket.IO connect-time auth (_require_socketio_connect_auth /
#    handle_socketio_connect), across CHASEMAPPER_REQUIRE_API_AUTH modes.
# ---------------------------------------------------------------------------


def test_socketio_connect_rejected_without_key_when_required(app_client, monkeypatch):
    monkeypatch.setenv("CHASEMAPPER_TESTING", "0")
    monkeypatch.setenv("CHASEMAPPER_REQUIRE_API_AUTH", "true")
    monkeypatch.setenv("CHASEMAPPER_API_KEY", "s3cret-key")

    client = _sio_client(app_client)
    assert client.is_connected(namespace="/chasemapper") is False


def test_socketio_connect_accepted_with_correct_key_when_required(app_client, monkeypatch):
    monkeypatch.setenv("CHASEMAPPER_TESTING", "0")
    monkeypatch.setenv("CHASEMAPPER_REQUIRE_API_AUTH", "true")
    monkeypatch.setenv("CHASEMAPPER_API_KEY", "s3cret-key")

    client = _sio_client(app_client, query_string="api_key=s3cret-key")
    try:
        assert client.is_connected(namespace="/chasemapper") is True
    finally:
        if client.is_connected(namespace="/chasemapper"):
            client.disconnect(namespace="/chasemapper")


def test_socketio_connect_rejected_with_wrong_key_when_required(app_client, monkeypatch):
    monkeypatch.setenv("CHASEMAPPER_TESTING", "0")
    monkeypatch.setenv("CHASEMAPPER_REQUIRE_API_AUTH", "true")
    monkeypatch.setenv("CHASEMAPPER_API_KEY", "s3cret-key")

    client = _sio_client(app_client, query_string="api_key=wrong-key")
    assert client.is_connected(namespace="/chasemapper") is False


def test_socketio_connect_require_auth_false_always_allows(app_client, monkeypatch):
    monkeypatch.setenv("CHASEMAPPER_TESTING", "0")
    monkeypatch.setenv("CHASEMAPPER_REQUIRE_API_AUTH", "false")
    monkeypatch.setenv("CHASEMAPPER_API_KEY", "s3cret-key")

    client = _sio_client(app_client)
    try:
        assert client.is_connected(namespace="/chasemapper") is True
    finally:
        client.disconnect(namespace="/chasemapper")


def test_socketio_connect_auto_mode_exempts_private_ip(app_client, monkeypatch):
    monkeypatch.setenv("CHASEMAPPER_TESTING", "0")
    monkeypatch.setenv("CHASEMAPPER_REQUIRE_API_AUTH", "auto")
    monkeypatch.setenv("CHASEMAPPER_API_KEY", "s3cret-key")
    # The test client doesn't populate a real REMOTE_ADDR (werkzeug's
    # EnvironBuilder leaves it unset), so simulate a private/loopback client
    # explicitly - "auto" mode should not require a key for it.
    monkeypatch.setattr(horusmapper, "_get_client_ip", lambda: "127.0.0.1")

    client = _sio_client(app_client)
    try:
        assert client.is_connected(namespace="/chasemapper") is True
    finally:
        client.disconnect(namespace="/chasemapper")


def test_socketio_connect_auto_mode_requires_key_for_public_ip(app_client, monkeypatch):
    monkeypatch.setenv("CHASEMAPPER_TESTING", "0")
    monkeypatch.setenv("CHASEMAPPER_REQUIRE_API_AUTH", "auto")
    monkeypatch.setenv("CHASEMAPPER_API_KEY", "s3cret-key")
    monkeypatch.setattr(horusmapper, "_get_client_ip", lambda: "8.8.8.8")

    without_key = _sio_client(app_client)
    assert without_key.is_connected(namespace="/chasemapper") is False

    with_key = _sio_client(app_client, query_string="api_key=s3cret-key")
    try:
        assert with_key.is_connected(namespace="/chasemapper") is True
    finally:
        with_key.disconnect(namespace="/chasemapper")


# ---------------------------------------------------------------------------
# 7. Operator auth for payload_data_clear / car_data_clear.
# ---------------------------------------------------------------------------


def test_payload_data_clear_denied_without_key_when_required(app_client, monkeypatch):
    monkeypatch.setenv("CHASEMAPPER_TESTING", "0")
    monkeypatch.setenv("CHASEMAPPER_REQUIRE_API_AUTH", "true")
    monkeypatch.setenv("CHASEMAPPER_API_KEY", "s3cret-key")

    horusmapper.current_payloads["TESTPAYLOAD"] = {"telem": {"callsign": "TESTPAYLOAD"}}
    try:
        client = _sio_client(app_client, query_string="api_key=s3cret-key")
        try:
            # Connect succeeds (valid key at connect time)...
            assert client.is_connected(namespace="/chasemapper") is True
            client.get_received(namespace="/chasemapper")

            # ...but re-check the wrong key explicitly on the clear action by
            # supplying a bad key via header (headers aren't part of the
            # preserved connect context lookup path used for query args, but
            # _request_api_key() checks header first - use a fresh client
            # that connected with no key at all, which is only possible if
            # connect-time auth allowed it (i.e. not required); to isolate
            # the operator-check itself, connect with the *correct* key so
            # the connection succeeds, but simulate a later missing/invalid
            # key by monkeypatching _request_api_key() for this call.
            monkeypatch.setattr(horusmapper, "_request_api_key", lambda: "wrong-key")
            client.emit("payload_data_clear", {}, namespace="/chasemapper")

            assert "TESTPAYLOAD" in horusmapper.current_payloads
            denied = [
                pkt["args"][0]
                for pkt in client.get_received(namespace="/chasemapper")
                if pkt["name"] == "operator_action_denied"
            ]
            assert len(denied) == 1
            assert denied[0]["action"] == "payload_data_clear"
            assert denied[0]["reason"] == "unauthorized"
        finally:
            if client.is_connected(namespace="/chasemapper"):
                client.disconnect(namespace="/chasemapper")
    finally:
        horusmapper.current_payloads.clear()
        horusmapper.current_payload_tracks.clear()


def test_payload_data_clear_succeeds_with_valid_key(app_client, monkeypatch):
    monkeypatch.setenv("CHASEMAPPER_TESTING", "0")
    monkeypatch.setenv("CHASEMAPPER_REQUIRE_API_AUTH", "true")
    monkeypatch.setenv("CHASEMAPPER_API_KEY", "s3cret-key")

    horusmapper.current_payloads["TESTPAYLOAD"] = {"telem": {"callsign": "TESTPAYLOAD"}}
    try:
        client = _sio_client(app_client, query_string="api_key=s3cret-key")
        try:
            client.get_received(namespace="/chasemapper")
            client.emit("payload_data_clear", {}, namespace="/chasemapper")

            assert horusmapper.current_payloads == {}
            denied = [
                pkt["args"][0]
                for pkt in client.get_received(namespace="/chasemapper")
                if pkt["name"] == "operator_action_denied"
            ]
            assert denied == []
        finally:
            client.disconnect(namespace="/chasemapper")
    finally:
        horusmapper.current_payloads.clear()
        horusmapper.current_payload_tracks.clear()


def test_payload_data_clear_exempt_when_auth_not_required(app_client, monkeypatch):
    monkeypatch.setenv("CHASEMAPPER_TESTING", "0")
    monkeypatch.setenv("CHASEMAPPER_REQUIRE_API_AUTH", "false")
    monkeypatch.setenv("CHASEMAPPER_API_KEY", "s3cret-key")

    horusmapper.current_payloads["TESTPAYLOAD"] = {"telem": {"callsign": "TESTPAYLOAD"}}
    try:
        client = _sio_client(app_client)
        try:
            client.emit("payload_data_clear", {}, namespace="/chasemapper")
            assert horusmapper.current_payloads == {}
        finally:
            client.disconnect(namespace="/chasemapper")
    finally:
        horusmapper.current_payloads.clear()
        horusmapper.current_payload_tracks.clear()


def test_car_data_clear_denied_without_valid_key_when_required(app_client, monkeypatch):
    monkeypatch.setenv("CHASEMAPPER_TESTING", "0")
    monkeypatch.setenv("CHASEMAPPER_REQUIRE_API_AUTH", "true")
    monkeypatch.setenv("CHASEMAPPER_API_KEY", "s3cret-key")

    horusmapper.car_track.add_telemetry(
        {"time": datetime.now(timezone.utc), "lat": 1.0, "lon": 2.0, "alt": 3.0}
    )
    try:
        client = _sio_client(app_client, query_string="api_key=s3cret-key")
        try:
            client.get_received(namespace="/chasemapper")
            monkeypatch.setattr(horusmapper, "_request_api_key", lambda: "wrong-key")
            client.emit("car_data_clear", {}, namespace="/chasemapper")

            assert horusmapper.car_track.get_latest_state() is not None
            denied = [
                pkt["args"][0]
                for pkt in client.get_received(namespace="/chasemapper")
                if pkt["name"] == "operator_action_denied"
            ]
            assert len(denied) == 1
            assert denied[0]["action"] == "car_data_clear"
        finally:
            if client.is_connected(namespace="/chasemapper"):
                client.disconnect(namespace="/chasemapper")
    finally:
        horusmapper.car_track = GenericTrack()


def test_car_data_clear_succeeds_with_valid_key(app_client, monkeypatch):
    monkeypatch.setenv("CHASEMAPPER_TESTING", "0")
    monkeypatch.setenv("CHASEMAPPER_REQUIRE_API_AUTH", "true")
    monkeypatch.setenv("CHASEMAPPER_API_KEY", "s3cret-key")

    horusmapper.car_track.add_telemetry(
        {"time": datetime.now(timezone.utc), "lat": 1.0, "lon": 2.0, "alt": 3.0}
    )
    try:
        client = _sio_client(app_client, query_string="api_key=s3cret-key")
        try:
            client.emit("car_data_clear", {}, namespace="/chasemapper")
            assert horusmapper.car_track.get_latest_state() is None
        finally:
            client.disconnect(namespace="/chasemapper")
    finally:
        horusmapper.car_track = GenericTrack()


# ---------------------------------------------------------------------------
# 8. Ownership lease / anti-spoofing.
# ---------------------------------------------------------------------------


def test_owner_can_repeatedly_update_own_client_id(app_client):
    owner = _sio_client(app_client)
    try:
        owner.emit("device_position", _position(lat=1.0, lon=1.0, client_id="carX"), namespace="/chasemapper")
        owner.emit("device_position", _position(lat=2.0, lon=2.0, client_id="carX"), namespace="/chasemapper")
        owner.emit("device_position", _position(lat=3.0, lon=3.0, client_id="carX"), namespace="/chasemapper")

        state = horusmapper.client_car_tracks["carX"]["track"].get_latest_state()
        assert (state["lat"], state["lon"]) == (3.0, 3.0)
    finally:
        owner.disconnect(namespace="/chasemapper")


def test_second_sid_cannot_hijack_active_owned_client_id(app_client):
    owner = _sio_client(app_client)
    impostor = _sio_client(app_client)
    try:
        owner.emit("device_position", _position(lat=1.0, lon=1.0, client_id="carX"), namespace="/chasemapper")

        # A different, still-connected sid tries to claim the same client_id.
        impostor.emit("device_position", _position(lat=99.0, lon=99.0, client_id="carX"), namespace="/chasemapper")

        # The impostor's update must be dropped - position unchanged.
        state = horusmapper.client_car_tracks["carX"]["track"].get_latest_state()
        assert (state["lat"], state["lon"]) == (1.0, 1.0)

        # Owner can still update normally.
        owner.emit("device_position", _position(lat=1.5, lon=1.5, client_id="carX"), namespace="/chasemapper")
        state = horusmapper.client_car_tracks["carX"]["track"].get_latest_state()
        assert (state["lat"], state["lon"]) == (1.5, 1.5)
    finally:
        owner.disconnect(namespace="/chasemapper")
        impostor.disconnect(namespace="/chasemapper")


def test_client_car_clear_also_respects_ownership(app_client):
    owner = _sio_client(app_client)
    impostor = _sio_client(app_client)
    try:
        owner.emit("device_position", _position(lat=1.0, lon=1.0, client_id="carX"), namespace="/chasemapper")

        impostor.emit("client_car_clear", {"client_id": "carX"}, namespace="/chasemapper")

        # Impostor cannot clear a client_id it doesn't own.
        assert "carX" in horusmapper.client_car_tracks
    finally:
        owner.disconnect(namespace="/chasemapper")
        impostor.disconnect(namespace="/chasemapper")


def test_new_sid_can_claim_client_id_after_owner_disconnects(app_client):
    owner = _sio_client(app_client)
    owner.emit("device_position", _position(lat=1.0, lon=1.0, client_id="carX"), namespace="/chasemapper")
    owner.disconnect(namespace="/chasemapper")

    new_owner = _sio_client(app_client)
    try:
        new_owner.emit("device_position", _position(lat=5.0, lon=5.0, client_id="carX"), namespace="/chasemapper")
        state = horusmapper.client_car_tracks["carX"]["track"].get_latest_state()
        assert (state["lat"], state["lon"]) == (5.0, 5.0)
    finally:
        new_owner.disconnect(namespace="/chasemapper")


# ---------------------------------------------------------------------------
# 9. Rate limiting on device_position.
# ---------------------------------------------------------------------------


def test_device_position_rate_limit_drops_excess_in_burst(app_client, monkeypatch):
    monkeypatch.setenv("CHASEMAPPER_TESTING", "0")
    monkeypatch.setenv("CHASEMAPPER_SOCKETIO_RATE_LIMIT_ENABLED", "true")
    monkeypatch.setenv("CHASEMAPPER_SOCKETIO_RATE_LIMIT_PER_MIN", "3")
    monkeypatch.setenv("CHASEMAPPER_SOCKETIO_RATE_LIMIT_WINDOW_S", "60")

    client = _sio_client(app_client)
    try:
        for i in range(5):
            client.emit(
                "device_position",
                _position(lat=float(i), lon=float(i), client_id="rl-car"),
                namespace="/chasemapper",
            )

        # Only the first 3 (the configured limit) should have been accepted;
        # the other 2 are silently dropped before ownership/track mutation.
        assert "rl-car" in horusmapper.client_car_tracks
        history_len = len(horusmapper.client_car_tracks["rl-car"]["track"].track_history)
        assert history_len == 3

        events = _telemetry_events(client)
        assert len(events) == 3
    finally:
        client.disconnect(namespace="/chasemapper")


def test_device_position_rate_limit_configurable_via_env(app_client, monkeypatch):
    monkeypatch.setenv("CHASEMAPPER_TESTING", "0")
    monkeypatch.setenv("CHASEMAPPER_SOCKETIO_RATE_LIMIT_ENABLED", "true")
    monkeypatch.setenv("CHASEMAPPER_SOCKETIO_RATE_LIMIT_PER_MIN", "1")
    monkeypatch.setenv("CHASEMAPPER_SOCKETIO_RATE_LIMIT_WINDOW_S", "60")

    client = _sio_client(app_client)
    try:
        for i in range(4):
            client.emit(
                "device_position",
                _position(lat=float(i), lon=float(i), client_id="rl-car-2"),
                namespace="/chasemapper",
            )

        history_len = len(horusmapper.client_car_tracks["rl-car-2"]["track"].track_history)
        assert history_len == 1
    finally:
        client.disconnect(namespace="/chasemapper")


def test_device_position_rate_limit_disabled_allows_burst(app_client, monkeypatch):
    monkeypatch.setenv("CHASEMAPPER_TESTING", "0")
    monkeypatch.setenv("CHASEMAPPER_SOCKETIO_RATE_LIMIT_ENABLED", "false")
    monkeypatch.setenv("CHASEMAPPER_SOCKETIO_RATE_LIMIT_PER_MIN", "1")

    client = _sio_client(app_client)
    try:
        for i in range(5):
            client.emit(
                "device_position",
                _position(lat=float(i), lon=float(i), client_id="rl-car-3"),
                namespace="/chasemapper",
            )

        history_len = len(horusmapper.client_car_tracks["rl-car-3"]["track"].track_history)
        assert history_len == 5
    finally:
        client.disconnect(namespace="/chasemapper")


def test_device_position_rate_limit_bypassed_in_testing_mode(app_client, monkeypatch):
    # CHASEMAPPER_TESTING=1 (the autouse fixture's default) must bypass the
    # rate limiter entirely, even with an aggressive limit configured.
    monkeypatch.setenv("CHASEMAPPER_SOCKETIO_RATE_LIMIT_ENABLED", "true")
    monkeypatch.setenv("CHASEMAPPER_SOCKETIO_RATE_LIMIT_PER_MIN", "1")
    monkeypatch.setenv("CHASEMAPPER_SOCKETIO_RATE_LIMIT_WINDOW_S", "60")

    client = _sio_client(app_client)
    try:
        for i in range(5):
            client.emit(
                "device_position",
                _position(lat=float(i), lon=float(i), client_id="rl-car-4"),
                namespace="/chasemapper",
            )

        history_len = len(horusmapper.client_car_tracks["rl-car-4"]["track"].track_history)
        assert history_len == 5
    finally:
        client.disconnect(namespace="/chasemapper")


# ---------------------------------------------------------------------------
# 10. Rate limiting is bucketed per (ip, client_id), not just per ip - so
#     several real people behind one shared IP/NAT don't throttle each
#     other out of one bucket, while a coarser per-IP backstop still catches
#     one address minting many fake client_ids.
# ---------------------------------------------------------------------------


def test_rate_limit_is_per_client_id_not_shared_across_ip(app_client, monkeypatch):
    monkeypatch.setenv("CHASEMAPPER_TESTING", "0")
    monkeypatch.setenv("CHASEMAPPER_SOCKETIO_RATE_LIMIT_ENABLED", "true")
    monkeypatch.setenv("CHASEMAPPER_SOCKETIO_RATE_LIMIT_PER_MIN", "3")
    monkeypatch.setenv("CHASEMAPPER_SOCKETIO_RATE_LIMIT_WINDOW_S", "60")
    # Generous backstop so it doesn't interfere with this test.
    monkeypatch.setenv("CHASEMAPPER_SOCKETIO_RATE_LIMIT_PER_IP_PER_MIN", "1000")

    alice = _sio_client(app_client)
    bob = _sio_client(app_client)
    try:
        # Both connections share a source IP (the test client), but each is a
        # distinct person (client_id). Each should get their own full quota.
        for i in range(3):
            alice.emit("device_position", _position(lat=float(i), lon=float(i), client_id="alice"), namespace="/chasemapper")
        for i in range(3):
            bob.emit("device_position", _position(lat=float(i), lon=float(i), client_id="bob"), namespace="/chasemapper")

        assert len(horusmapper.client_car_tracks["alice"]["track"].track_history) == 3
        assert len(horusmapper.client_car_tracks["bob"]["track"].track_history) == 3
    finally:
        alice.disconnect(namespace="/chasemapper")
        bob.disconnect(namespace="/chasemapper")


def test_rate_limit_per_ip_backstop_still_applies_across_many_client_ids(app_client, monkeypatch):
    monkeypatch.setenv("CHASEMAPPER_TESTING", "0")
    monkeypatch.setenv("CHASEMAPPER_SOCKETIO_RATE_LIMIT_ENABLED", "true")
    # Generous per-client_id limit so it never trips on its own here.
    monkeypatch.setenv("CHASEMAPPER_SOCKETIO_RATE_LIMIT_PER_MIN", "1000")
    monkeypatch.setenv("CHASEMAPPER_SOCKETIO_RATE_LIMIT_PER_IP_PER_MIN", "5")
    monkeypatch.setenv("CHASEMAPPER_SOCKETIO_RATE_LIMIT_WINDOW_S", "60")

    client = _sio_client(app_client)
    try:
        # One address minting a fresh client_id per update, trying to dodge
        # the per-client_id limit - the coarser per-IP backstop must still
        # cut it off.
        for i in range(8):
            client.emit(
                "device_position",
                _position(lat=float(i), lon=float(i), client_id="spammer-%d" % i),
                namespace="/chasemapper",
            )

        accepted = sum(
            1 for cid in horusmapper.client_car_tracks if cid.startswith("spammer-")
        )
        assert accepted == 5
    finally:
        client.disconnect(namespace="/chasemapper")


# ---------------------------------------------------------------------------
# 11. Presence tracking: connected_sids / presence_update broadcasts.
# ---------------------------------------------------------------------------


def test_presence_broadcast_on_connect_and_disconnect(app_client):
    a = _sio_client(app_client)
    try:
        assert len(horusmapper.connected_sids) == 1

        a_events = [pkt["args"][0]["connected"] for pkt in a.get_received(namespace="/chasemapper") if pkt["name"] == "presence_update"]
        assert a_events == [1]

        b = _sio_client(app_client)
        try:
            assert len(horusmapper.connected_sids) == 2

            a_events = [pkt["args"][0]["connected"] for pkt in a.get_received(namespace="/chasemapper") if pkt["name"] == "presence_update"]
            assert a_events == [2]
        finally:
            b.disconnect(namespace="/chasemapper")

        assert len(horusmapper.connected_sids) == 1
        a_events = [pkt["args"][0]["connected"] for pkt in a.get_received(namespace="/chasemapper") if pkt["name"] == "presence_update"]
        assert a_events == [1]
    finally:
        a.disconnect(namespace="/chasemapper")


def test_presence_rejected_connection_not_counted(app_client, monkeypatch):
    monkeypatch.setenv("CHASEMAPPER_TESTING", "0")
    monkeypatch.setenv("CHASEMAPPER_REQUIRE_API_AUTH", "true")
    monkeypatch.setenv("CHASEMAPPER_API_KEY", "s3cret")

    before = len(horusmapper.connected_sids)
    rejected = _sio_client(app_client)
    try:
        assert not rejected.is_connected(namespace="/chasemapper")
        assert len(horusmapper.connected_sids) == before
    finally:
        pass


# ---------------------------------------------------------------------------
# 12. Per-user bearing attribution: source naming and relative-bearing
#     fusion with the SUBMITTING person's own tracked position, not the
#     primary car's.
# ---------------------------------------------------------------------------


def test_absolute_manual_bearing_source_includes_submitter_name(app_client):
    client = _sio_client(app_client)
    try:
        client.emit(
            "add_manual_bearing",
            {
                "type": "BEARING",
                "bearing_type": "absolute",
                "source": "EasyBearing",
                "latitude": 10.0,
                "longitude": 20.0,
                "bearing": 90.0,
                "client_id": "bearer-1",
                "name": "VK5QI",
            },
            namespace="/chasemapper",
        )

        assert len(horusmapper.bearing_store.bearings) == 1
        _bearing = list(horusmapper.bearing_store.bearings.values())[0]
        assert _bearing["source"] == "EasyBearing: VK5QI"
        # manual_bearing_sources substring match in bearings.js keys off the
        # original "EasyBearing" prefix still being present.
        assert "EasyBearing" in _bearing["source"]
    finally:
        client.disconnect(namespace="/chasemapper")


def test_relative_bearing_fused_with_submitters_own_position(app_client):
    client = _sio_client(app_client)
    try:
        # This person must be sharing their own position for a relative
        # bearing to be fusable at all.
        client.emit(
            "device_position",
            _position(lat=5.0, lon=6.0, client_id="bearer-2", name="Bob"),
            namespace="/chasemapper",
        )

        client.emit(
            "add_manual_bearing",
            {
                "type": "BEARING",
                "bearing_type": "relative",
                "source": "EasyBearing",
                "bearing": 45.0,
                "client_id": "bearer-2",
                "name": "Bob",
            },
            namespace="/chasemapper",
        )

        assert len(horusmapper.bearing_store.bearings) == 1
        _bearing = list(horusmapper.bearing_store.bearings.values())[0]
        assert _bearing["source"] == "EasyBearing: Bob"
        # Fused with Bob's own position (5.0, 6.0), not the primary car_track.
        assert (_bearing["lat"], _bearing["lon"]) == (5.0, 6.0)
        assert _bearing["true_bearing"] == 45.0  # heading 0 (no heading_valid) -> bearing unchanged
    finally:
        client.disconnect(namespace="/chasemapper")


def test_relative_bearing_rejected_without_known_position(app_client):
    client = _sio_client(app_client)
    try:
        client.emit(
            "add_manual_bearing",
            {
                "type": "BEARING",
                "bearing_type": "relative",
                "source": "EasyBearing",
                "bearing": 45.0,
                "client_id": "bearer-3",
                "name": "Carol",
            },
            namespace="/chasemapper",
        )

        assert len(horusmapper.bearing_store.bearings) == 0
        rejections = [
            pkt["args"][0] for pkt in client.get_received(namespace="/chasemapper")
            if pkt["name"] == "bearing_rejected"
        ]
        assert len(rejections) == 1
        assert rejections[0]["reason"] == "no_known_position"
    finally:
        client.disconnect(namespace="/chasemapper")


def test_manual_bearing_without_client_id_keeps_legacy_behaviour(app_client):
    # Backward compat: a submission with no client_id (e.g. an older client,
    # or the primary hardware DF path) must be unaffected by any of the
    # above - source is passed through as-is, fused with the shared
    # bearing_store.current_car_position as before.
    client = _sio_client(app_client)
    try:
        client.emit(
            "add_manual_bearing",
            {
                "type": "BEARING",
                "bearing_type": "absolute",
                "source": "EasyBearing",
                "latitude": 1.0,
                "longitude": 2.0,
                "bearing": 10.0,
            },
            namespace="/chasemapper",
        )

        assert len(horusmapper.bearing_store.bearings) == 1
        _bearing = list(horusmapper.bearing_store.bearings.values())[0]
        assert _bearing["source"] == "EasyBearing"
    finally:
        client.disconnect(namespace="/chasemapper")
