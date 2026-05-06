from chasemapper.listeners import OziListener
from datetime import datetime


def test_ozi_telemetry_and_waypoint_callbacks():
    received = {}

    def tele_cb(pkt):
        received['tele'] = pkt

    def wp_cb(pkt):
        received['wp'] = pkt

    ol = OziListener(hostname='127.0.0.1', port=9000, telemetry_callback=tele_cb, waypoint_callback=wp_cb)
    # Call handle_telemetry_packet directly
    packet = 'TELEMETRY,12:00:00,12.34,56.78,100.0'
    ol.handle_telemetry_packet(packet)
    assert 'tele' in received
    assert received['tele']['lat'] == 12.34

    # Waypoint
    wp = 'WAYPOINT,FOO,12.34,56.78,Test'
    ol.handle_waypoint_packet(wp)
    assert 'wp' in received
    assert received['wp']['name'] == 'FOO'
