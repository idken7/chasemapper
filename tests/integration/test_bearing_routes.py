"""
Integration tests for the DOA bearing feature's server-side surface that
isn't already covered by tests/integration/test_multi_user_and_security.py
(which exercises the `add_manual_bearing` socket.io handler and per-user
fusion in depth):

  - The `/get_bearings` HTTP route the web UI polls on load
    (bearings.js's initialiseBearings()).
  - The `bearing_store_clear` socket.io event (the "clear all bearing data"
    button - bearings.js's flushBearings()).
  - Real end-to-end UDP ingestion: a hardware DOA source (e.g. KrakenSDR)
    broadcasts a BEARING UDP packet, chasemapper.listeners.UDPListener picks
    it up on a real loopback socket, and horusmapper's
    udp_listener_bearing_callback fuses it into a Bearings store - the same
    path exercised manually via `/api/*`-free hardware, as opposed to the
    browser-originated `add_manual_bearing` socket.io path.

See tests/unit/test_bearings.py for the Bearings class's own unit tests
(fusion math, pruning, KrakenSDR mirroring, etc).
"""
import json
import socket
import time

import pytest

import horusmapper
from chasemapper.bearings import Bearings
from chasemapper.listeners import UDPListener


@pytest.fixture(autouse=True)
def _reset_state(monkeypatch):
    """Mirrors test_multi_user_and_security.py's fixture: create_app() (used
    by app_client below) deliberately skips start_services(), so
    bearing_store is None unless we set it up ourselves. Give each test a
    fresh store and restore whatever was there afterwards."""
    monkeypatch.setenv("CHASEMAPPER_TESTING", "1")
    monkeypatch.delenv("CHASEMAPPER_REQUIRE_API_AUTH", raising=False)
    monkeypatch.delenv("CHASEMAPPER_API_KEY", raising=False)

    _prev_bearing_store = horusmapper.bearing_store
    horusmapper.bearing_store = Bearings(socketio_instance=horusmapper.socketio)

    yield

    horusmapper.bearing_store = _prev_bearing_store


@pytest.fixture
def app_client():
    app, _socketio = horusmapper.create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


def _sio_client(app_client):
    return horusmapper.socketio.test_client(
        horusmapper.app,
        namespace="/chasemapper",
        flask_test_client=app_client,
    )


# ---------------------------------------------------------------------------
# /get_bearings
# ---------------------------------------------------------------------------


def test_get_bearings_returns_empty_object_with_no_bearings(app_client):
    resp = app_client.get("/get_bearings")
    assert resp.status_code == 200
    assert json.loads(resp.data) == {}


def test_get_bearings_returns_stored_bearings(app_client):
    horusmapper.bearing_store.add_bearing({
        "type": "BEARING",
        "bearing_type": "absolute",
        "latitude": 10.0,
        "longitude": 20.0,
        "bearing": 90.0,
        "source": "yagi-1",
    })

    resp = app_client.get("/get_bearings")
    data = json.loads(resp.data)

    assert len(data) == 1
    _bearing = list(data.values())[0]
    assert _bearing["source"] == "yagi-1"
    assert _bearing["true_bearing"] == 90.0
    # This is exactly the shape bearings.js's initialiseBearings() ajax
    # success handler iterates and feeds into addBearing(key, value, false).
    assert _bearing["key"] in data


# ---------------------------------------------------------------------------
# bearing_store_clear socket.io event
# ---------------------------------------------------------------------------


def test_bearing_store_clear_flushes_store_and_notifies_clients(app_client):
    horusmapper.bearing_store.add_bearing({
        "type": "BEARING",
        "bearing_type": "absolute",
        "latitude": 1.0,
        "longitude": 2.0,
        "bearing": 45.0,
        "source": "yagi-1",
    })
    assert len(horusmapper.bearing_store.bearings) == 1

    client = _sio_client(app_client)
    try:
        client.emit("bearing_store_clear", {"data": "plzkthx"}, namespace="/chasemapper")

        assert horusmapper.bearing_store.bearings == {}

        events = [
            pkt["args"][0] for pkt in client.get_received(namespace="/chasemapper")
            if pkt["name"] == "server_bearings_cleared"
        ]
        assert len(events) == 1
    finally:
        client.disconnect(namespace="/chasemapper")


# ---------------------------------------------------------------------------
# Real UDP end-to-end ingestion (hardware DOA source -> UDPListener ->
# udp_listener_bearing_callback -> Bearings store)
# ---------------------------------------------------------------------------


def test_udp_bearing_packet_is_fused_into_bearing_store():
    # A real chase car position, so the incoming *relative* bearing has
    # something to fuse against (mirrors horusmapper's own car-state update
    # path, without pulling in the full telemetry pipeline).
    horusmapper.bearing_store.update_car_position({
        "time": None,
        "lat": -34.9,
        "lon": 138.6,
        "alt": 50.0,
        "heading": 90.0,
        "heading_valid": True,
        "speed": 10.0,
    })

    listener = UDPListener(
        bearing_callback=horusmapper.udp_listener_bearing_callback,
        port=0,
    )
    # port=0 asks the OS for a free port, but UDPListener always binds to
    # self.udp_port as given - bind our own probe socket first to reserve a
    # genuinely free one, same technique as
    # test_udp_telemetry_end_to_end.py's test_udp_payload_and_gps_trigger_callbacks.
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    probe.bind(("127.0.0.1", 0))
    free_port = probe.getsockname()[1]
    probe.close()
    listener.udp_port = free_port

    listener.start()
    try:
        deadline = time.monotonic() + 5.0
        while time.monotonic() < deadline and not listener.udp_listener_running:
            time.sleep(0.01)
        assert listener.udp_listener_running, "UDP listener did not start in time"

        bearing_packet = {
            "type": "BEARING",
            "bearing_type": "relative",
            "bearing": 10.0,
            "source": "yagi-udp",
            "confidence": 80.0,
        }

        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.sendto(json.dumps(bearing_packet).encode(), ("127.0.0.1", free_port))
        finally:
            sock.close()

        deadline = time.monotonic() + 5.0
        while time.monotonic() < deadline and len(horusmapper.bearing_store.bearings) == 0:
            time.sleep(0.02)

        assert len(horusmapper.bearing_store.bearings) == 1
        stored = list(horusmapper.bearing_store.bearings.values())[0]
        assert stored["source"] == "yagi-udp"
        # Fused with the car heading (90.0) set above: 10.0 + 90.0 = 100.0
        assert stored["true_bearing"] == 100.0
        assert (stored["lat"], stored["lon"]) == (-34.9, 138.6)
        assert horusmapper.bearing_mode is True
    finally:
        listener.close()
