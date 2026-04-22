#!/usr/bin/env python3
"""Simple test client to fetch server config, add an APRS callsign, and emit settings."""
import requests
import json
import time
from socketio import Client


def main():
    base = 'http://127.0.0.1:5001'
    # Fetch current server config
    r = requests.get(base + '/get_config')
    cfg = {}
    try:
        cfg = r.json()
    except Exception:
        print('Failed to fetch config')
        return

    # Ensure APRS fields exist
    if 'aprs_callsigns' not in cfg or not isinstance(cfg['aprs_callsigns'], list):
        cfg['aprs_callsigns'] = []
    if 'aprs_enabled' not in cfg:
        cfg['aprs_enabled'] = True

    callsign = 'KF6RFX-14'
    if callsign not in cfg['aprs_callsigns']:
        cfg['aprs_callsigns'].append(callsign)
    cfg['aprs_enabled'] = True

    sio = Client()

    @sio.event(namespace='/chasemapper')
    def connect():
        print('Connected to server, emitting client_settings_update')

    sio.connect(base)
    # Give socket a moment
    time.sleep(0.2)
    sio.emit('client_settings_update', cfg, namespace='/chasemapper')
    print('Emitted settings update.')
    time.sleep(1)
    sio.disconnect()


if __name__ == '__main__':
    main()
