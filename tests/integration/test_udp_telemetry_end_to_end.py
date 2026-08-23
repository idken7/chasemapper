"""
End-to-end test of UDPListener: sends real UDP packets over a loopback
socket and confirms both the balloon PAYLOAD_SUMMARY and chase-car GPS
callbacks fire with sane data. (Previously misnamed
test_chase_routing_integration.py - it has nothing to do with chase_routing.js
/ /api/route; that's covered by tests/integration/test_api_routes.py and
tests/integration/test_udp_listener.py covers the single-callback unit case.)
"""
import json
import math
import socket
import time
from chasemapper.listeners import UDPListener


def haversine_meters(lat1, lon1, lat2, lon2):
    R = 6371000.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi/2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda/2.0) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c


def test_udp_payload_and_gps_trigger_callbacks():
    received = {"summary": None, "gps": None}

    def summary_cb(pkt):
        received["summary"] = pkt

    def gps_cb(pkt):
        received["gps"] = pkt

    # Pick a free UDP port for the listener and start it
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.bind(('127.0.0.1', 0))
    free_port = s.getsockname()[1]
    s.close()

    listener = UDPListener(summary_callback=summary_cb, gps_callback=gps_cb, port=free_port)
    listener.start()

    # start() spawns a thread that creates and binds the socket
    # *asynchronously* (see udp_rx_thread) - wait for it to actually be bound
    # and listening before sending anything. UDP is connectionless: a packet
    # sent before the socket is bound is silently dropped with no error on
    # the sending side, and no amount of waiting afterward recovers it. This
    # race is rarely visible on a quiet machine (the OS schedules the new
    # thread almost immediately) but is real - it reproduces reliably under
    # heavy system load, where the listener thread can take much longer than
    # a fixed short sleep to even get scheduled once.
    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline and not listener.udp_listener_running:
        time.sleep(0.01)
    assert listener.udp_listener_running, "UDP listener did not start in time"

    # Simulated balloon landing prediction (PAYLOAD_SUMMARY)
    balloon = {
        "type": "PAYLOAD_SUMMARY",
        "callsign": "TEST1",
        "latitude": 39.7392,
        "longitude": -104.9903,
        "altitude": 25000,
    }

    # Simulated chase car GPS
    car = {"type": "GPS", "callsign": "CAR1", "lat": 40.0150, "lon": -105.2705}

    # Send packets via real UDP socket (end-to-end)
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.sendto(json.dumps(balloon).encode(), ('127.0.0.1', free_port))
        sock.sendto(json.dumps(car).encode(), ('127.0.0.1', free_port))
    finally:
        sock.close()

    # Poll for the background listener thread to process both packets rather
    # than a single fixed sleep - a fixed sleep is either needlessly slow (if
    # generous) or flaky under real machine load/scheduling variance (if
    # tight, as the previous 0.1s/0.2s sleeps were - this genuinely failed
    # under a loaded system, not because the feature was broken).
    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline and (received["summary"] is None or received["gps"] is None):
        time.sleep(0.02)

    assert received["summary"] is not None, "Summary callback not invoked"
    assert received["gps"] is not None, "GPS callback not invoked"

    # Validate coordinates and reasonable distance between them. UDPListener
    # passes the parsed JSON straight through to the callback unmodified (see
    # handle_udp_packet), so these keys - exactly as sent above - are always
    # present; assert on them directly rather than silently skipping the
    # check if the shape ever turned out to be different than expected.
    b = received["summary"]
    g = received["gps"]
    assert "latitude" in b and "longitude" in b
    assert "lat" in g and "lon" in g
    dist = haversine_meters(b["latitude"], b["longitude"], g["lat"], g["lon"])
    assert dist > 0 and dist < 500000, "Unexpected distance between balloon and car"

    # Cleanup
    listener.close()
