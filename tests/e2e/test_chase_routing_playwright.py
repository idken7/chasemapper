import time
from playwright.sync_api import sync_playwright


def test_chase_routing_modal_and_route_creation():
    url = "http://localhost:5001/"

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context()

        # Inject a stub for L.Routing.control before page scripts run
        context.add_init_script("""
            // Provide a minimal L.Routing.control stub that calls 'routesfound' after setWaypoints
            window._fakeLRoutingInjected = true;
            window.L = window.L || {};
            L.Routing = L.Routing || {};
            L.Routing.control = function(opts){
                var listeners = {};
                var ctrl = {
                    _listeners: listeners,
                    on: function(ev, cb){ listeners[ev] = cb; },
                    getWaypoints: function(){ return [{},{}]; },
                    setWaypoints: function(wp){
                        // simulate async route computation
                        setTimeout(function(){
                            if (listeners['routesfound']){
                                listeners['routesfound']({routes:[{summary:{totalDistance:1234,totalTime:600}, geometry:{coordinates:[[0,0],[1,1]]}}]});
                            }
                        }, 150);
                    }
                };
                window.router = ctrl;
                return ctrl;
            };
        """)

        page = context.new_page()
        page.goto(url)

        # Ensure page loaded
        time.sleep(0.5)

        # Inject balloon_positions and chase_car placeholders, then populate the calls dropdown
        page.evaluate("""
            window.balloon_positions = { 'TEST': { pred_marker: { getLatLng: function(){ return {lat:39.7392, lng:-104.9903}; } } } };
            window.manual_start = [40.0150, -105.2705];
            window.start_mode = 'manual';
            if (typeof populateCalls === 'function') populateCalls();
        """)

        # Click the Chase Routing button (easyButton class 'chaseRoutingButton')
        page.click('.chaseRoutingButton')

        # Wait for modal to open
        page.wait_for_selector('#chaseRoutingModal.is-open', timeout=2000)

        # Select the TEST callsign
        page.select_option('#chaseCalls', 'TEST')
        # Ensure manual mode selected and manual coords visible
        page.select_option('#startMode', 'manual')
        page.fill('#manualLat', '40.0150')
        page.fill('#manualLon', '-105.2705')

        # Click Start Routing
        page.click('#startChaseBtn')

        # Wait for the fake router to emit routesfound and modal to close
        page.wait_for_selector('#chaseRoutingModal:not(.is-open)', timeout=5000)

        browser.close()