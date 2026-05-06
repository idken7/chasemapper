import json
from chasemapper.listeners import UDPListener


def test_udp_listener_calls_callback():
    received = {}

    def cb(pkt):
        received['pkt'] = pkt

    listener = UDPListener(callback=cb)
    payload = {"type": "GPS", "lat": 12.34, "lon": 56.78}
    listener.handle_udp_packet(json.dumps(payload).encode())

    assert 'pkt' in received
    assert received['pkt'] == payload
