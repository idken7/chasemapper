#!/usr/bin/env python3
"""Quick functional test of refactored code."""

import sys
import os
import time
import requests
import threading

# Add the repo to path
sys.path.insert(0, os.path.dirname(__file__))

import horusmapper

def start_server():
    """Start the server in test mode."""
    os.environ['CHASEMAPPER_TESTING'] = '1'
    horusmapper.start_flask_server_thread()
    time.sleep(2)  # Wait for server to start

def test_server_responds():
    """Test that the server responds to basic requests."""
    port = horusmapper.chasemapper_config['flask_port']
    url = f'http://127.0.0.1:{port}/'
    
    try:
        response = requests.get(url, timeout=5)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        print("✓ Server responds to basic request")
        return True
    except Exception as e:
        print(f"✗ Server request failed: {e}")
        return False

def test_aprs_prediction_overrides():
    """Test that APRS prediction overrides work."""
    try:
        # Check that the override sidecar file path works
        config_path = horusmapper.chasemapper_config.get("config_filename", "horusmapper.cfg/horusmapper.cfg")
        sidecar_dir = horusmapper._config_base_dir(config_path)
        sidecar_path = os.path.join(sidecar_dir, "aprs_prediction_overrides.json")
        
        print(f"✓ APRS override sidecar path: {sidecar_path}")
        
        # Test sanitization
        test_data = {
            "CALLSIGN1": {"pred_burst": 28000, "pred_desc_rate": 6.0},
            "CALLSIGN2": {"pred_burst": 30000}
        }
        sanitized = horusmapper._sanitize_aprs_prediction_overrides(test_data)
        assert "CALLSIGN1" in sanitized
        assert sanitized["CALLSIGN1"]["pred_burst"] == 28000
        print("✓ APRS override sanitization works")
        return True
    except Exception as e:
        print(f"✗ APRS override test failed: {e}")
        return False

def test_javascript_caching():
    """Verify that cache functions are defined in JavaScript."""
    settings_js_path = os.path.join(os.path.dirname(__file__), "static/js/settings.js")
    try:
        with open(settings_js_path, 'r') as f:
            content = f.read()
            
        # Check for cache functions
        required_functions = [
            'getAprsListElement',
            'getAprsPredictionModal', 
            'getAprsStatusDotElement'
        ]
        
        for func in required_functions:
            if f'function {func}' in content:
                print(f"✓ Cache function {func} found")
            else:
                print(f"✗ Cache function {func} not found")
                return False
                
        return True
    except Exception as e:
        print(f"✗ JavaScript check failed: {e}")
        return False

if __name__ == '__main__':
    print("Running refactoring verification tests...\n")
    
    results = [
        ("JavaScript caching", test_javascript_caching()),
        ("APRS override system", test_aprs_prediction_overrides()),
    ]
    
    # Only test server if in CI or if tests are explicitly requested
    if os.environ.get('RUN_SERVER_TEST'):
        try:
            start_server()
            results.append(("Server response", test_server_responds()))
        except Exception as e:
            print(f"✗ Server test error: {e}")
            results.append(("Server response", False))
    
    print("\n" + "="*50)
    print("Test Summary:")
    for name, passed in results:
        status = "✓ PASS" if passed else "✗ FAIL"
        print(f"  {status}: {name}")
    
    all_passed = all(r[1] for r in results)
    sys.exit(0 if all_passed else 1)
