#!/usr/bin/env python3
"""
Test script to inject fake balloon telemetry and chase car positions
for testing real-time route updates on localhost.
"""

import json
import socket
import time
import math

def send_udp(host, port, data):
    """Send UDP data to host:port"""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        payload = json.dumps(data).encode() if isinstance(data, dict) else str(data).encode()
        s.sendto(payload, (host, port))
        print(f"Sent to {host}:{port}: {payload[:100]}")
    finally:
        s.close()

def send_payload_summary(callsign, lat, lon, alt, ascent_rate=5.0, speed=0, heading=0):
    """
    Send a Horus UDP 'Payload Summary' message with balloon telemetry.
    This will create a balloon track on the map.
    """
    msg = {
        "callsign": callsign,
        "latitude": lat,
        "longitude": lon,
        "altitude": alt,
        "speed": speed,
        "heading": heading,
        "ascent_rate": ascent_rate,
        "time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "type": "payload_summary"
    }
    send_udp("localhost", 55673, msg)

def send_car_gps(lat, lon, alt=0, speed=0, heading=0):
    """
    Send a Horus UDP 'Chase Car Position' message.
    This updates the chase car position on the map.
    """
    msg = {
        "callsign": "CAR",
        "latitude": lat,
        "longitude": lon,
        "altitude": alt,
        "speed": speed,
        "heading": heading,
        "type": "car_gps"
    }
    send_udp("localhost", 55672, msg)

def test_scenario_1_basic():
    """
    Scenario 1: Basic test
    - Launch a balloon near Golden, Colorado
    - Chase car starts near Boulder, Colorado
    - Trigger routing and monitor console for distance calculations
    """
    print("\n=== Scenario 1: Basic Route Tracking ===\n")
    
    # Golden, CO (balloon landing location)
    balloon_lat, balloon_lon, balloon_alt = 39.7392, -104.9903, 25000
    
    # Boulder, CO (chase car starting position)
    car_lat, car_lon = 40.0150, -105.2705
    
    print("Sending initial balloon telemetry (landing at Golden, CO)...")
    send_payload_summary("W5TEST", balloon_lat, balloon_lon, balloon_alt, ascent_rate=5.0)
    
    time.sleep(1)
    
    print("Sending initial car position (Boulder, CO)...")
    send_car_gps(car_lat, car_lon, alt=1650)
    
    print("\n✓ Initial data sent. Go to web UI and:")
    print("  1. Click the 'Chase Routing' button (compass icon top-right)")
    print("  2. Select 'W5TEST' as the callsign")
    print("  3. Click 'Start Routing'")
    print("  4. Watch the browser console for distance calculations")
    print("\nThen run Scenario 2 to simulate car movement...")

def test_scenario_2_car_movement():
    """
    Scenario 2: Simulate car moving towards balloon
    - Car starts near Boulder
    - Car moves 100m south (should NOT trigger route update)
    - Car moves another 100m south (should trigger if >100m cumulative)
    - Show that routes recalculate as car moves
    """
    print("\n=== Scenario 2: Car Movement & Route Updates ===\n")
    
    balloon_lat, balloon_lon = 39.7392, -104.9903
    
    # Boulder starting position
    car_lat, car_lon = 40.0150, -105.2705
    
    print("Initial state: Car at Boulder, CO")
    send_car_gps(car_lat, car_lon, alt=1650)
    time.sleep(2)
    
    # Move car south by approximately 100 meters
    # 1 degree latitude ≈ 111 km, so 100m ≈ 0.0009 degrees
    car_lat_2 = car_lat - 0.0009  # Move ~100m south
    print(f"\n[STEP 1] Moving car ~100m south to {car_lat_2:.6f}, {car_lon:.6f}")
    print("Expected: Route should NOT update (distance < 100m)")
    send_car_gps(car_lat_2, car_lon, alt=1650)
    time.sleep(3)
    
    # Move car another ~110 meters south (total ~210m from start)
    car_lat_3 = car_lat_2 - 0.001  # Move another ~110m south
    print(f"\n[STEP 2] Moving car another ~110m south to {car_lat_3:.6f}, {car_lon:.6f}")
    print("Expected: Route SHOULD update (cumulative distance > 100m from last calc)")
    print("         Watch console for 'handleCarMovementForRouting' execution")
    send_car_gps(car_lat_3, car_lon, alt=1650)
    time.sleep(3)
    
    # Move 50m more (should not trigger yet)
    car_lat_4 = car_lat_3 - 0.00045
    print(f"\n[STEP 3] Moving car another ~50m south to {car_lat_4:.6f}, {car_lon:.6f}")
    print("Expected: Route should NOT update (distance < 100m from last calc)")
    send_car_gps(car_lat_4, car_lon, alt=1650)
    time.sleep(3)
    
    # Move 100m more (should trigger)
    car_lat_5 = car_lat_4 - 0.0009
    print(f"\n[STEP 4] Moving car another ~100m south to {car_lat_5:.6f}, {car_lon:.6f}")
    print("Expected: Route SHOULD update again (distance > 100m from last calc)")
    send_car_gps(car_lat_5, car_lon, alt=1650)
    
    print("\n✓ Scenario 2 complete. Check browser console for distance logs.")

def test_scenario_3_prediction_update():
    """
    Scenario 3: Test prediction update triggering route recalc
    - Update landing location while car is stationary
    - Route should recalculate with new prediction
    """
    print("\n=== Scenario 3: Prediction Update Routes ===\n")
    
    # Move balloon landing location
    balloon_lat, balloon_lon, balloon_alt = 39.7500, -104.9800, 25000
    
    print("Updating balloon landing location...")
    send_payload_summary("W5TEST", balloon_lat, balloon_lon, balloon_alt, ascent_rate=5.0)
    
    print("Car position remains the same (stationary)")
    car_lat, car_lon = 40.0150, -105.2705
    send_car_gps(car_lat, car_lon, alt=1650)
    
    print("\n✓ Prediction updated. Route should recalculate even though car didn't move.")
    print("  Check browser console for handlePrediction execution.")

if __name__ == "__main__":
    print("""
╔════════════════════════════════════════════════════════════════╗
║     ChaseMapper Route Update Testing - Localhost Simulator    ║
╚════════════════════════════════════════════════════════════════╝

SETUP:
1. Ensure horusmapper.cfg has car_source_type = horus_udp (not serial)
2. Restart Docker: docker compose restart
3. Open http://localhost:5001 in browser
4. Open DevTools Console (F12 → Console tab)
5. Run this script in another terminal

SCENARIOS:
""")
    
    print("Usage:")
    print("  python3 test_route_updates.py scenario1  # Initial setup")
    print("  python3 test_route_updates.py scenario2  # Car movement test")
    print("  python3 test_route_updates.py scenario3  # Prediction update test")
    print("  python3 test_route_updates.py all        # All scenarios")
    print()
    
    import sys
    if len(sys.argv) < 2:
        print("No scenario specified. Running scenario1 by default...\n")
        test_scenario_1_basic()
    elif sys.argv[1] == "scenario1":
        test_scenario_1_basic()
    elif sys.argv[1] == "scenario2":
        test_scenario_2_car_movement()
    elif sys.argv[1] == "scenario3":
        test_scenario_3_prediction_update()
    elif sys.argv[1] == "all":
        test_scenario_1_basic()
        time.sleep(2)
        test_scenario_2_car_movement()
        time.sleep(2)
        test_scenario_3_prediction_update()
    else:
        print(f"Unknown scenario: {sys.argv[1]}")
        print("Use: scenario1, scenario2, scenario3, or all")
