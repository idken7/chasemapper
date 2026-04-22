#!/usr/bin/env python3
"""Simple test harness to poll APRS for specific callsigns using APRSTracker."""
import time
import logging
import os

from chasemapper.aprs_tracker import APRSTracker


results = []


def cb(data):
    print("BEACON:", data)
    results.append(data)


def main():
    logging.basicConfig(level=logging.INFO)
    calls = ["KF6RFX-2", "KF6RFX-14"]
    api_key = os.environ.get('APRS_API_KEY')
    tracker = APRSTracker(callsigns=calls, poll_interval=10, callback=cb, api_key=api_key)
    tracker.daemon = True
    tracker.start()

    try:
        # Run for 40 seconds to collect beacons
        time.sleep(40)
    except KeyboardInterrupt:
        pass

    tracker.stop()
    try:
        tracker.join(timeout=2)
    except Exception:
        pass

    print("\nCollected %d beacons:" % len(results))
    for r in results:
        print(r)


if __name__ == '__main__':
    main()
