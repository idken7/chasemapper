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
        time.sleep(0.1)
        sock.sendto(json.dumps(car).encode(), ('127.0.0.1', free_port))
    finally:
        sock.close()

    # Give listener a moment to process
    time.sleep(0.2)

    assert received["summary"] is not None, "Summary callback not invoked"
    assert received["gps"] is not None, "GPS callback not invoked"

    # Validate coordinates and reasonable distance between them
    b = received["summary"]
    g = received["gps"]
    if "latitude" in b and "longitude" in b and "lat" in g and "lon" in g:
        dist = haversine_meters(b["latitude"], b["longitude"], g["lat"], g["lon"])
        assert dist > 0 and dist < 500000, "Unexpected distance between balloon and car"

    # Cleanup
    listener.close()
