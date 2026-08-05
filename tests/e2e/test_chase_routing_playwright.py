import time
from playwright.sync_api import sync_playwright


def test_chase_routing_modal_and_route_creation():
    url = "http://localhost:5001/"

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context()

        # Stub L.Routing.control so the test is deterministic and network-free.
        #
        # We used to only inject this via context.add_init_script, which runs
        # before any page script - but templates/index.html loads the real
        # leaflet-routing-machine.min.js afterwards, and that library
        # unconditionally overwrites L.Routing.control with its real
        # implementation. By the time chase_routing.js calls
        # `L.Routing.control(...)` (on the Start Routing click, well after
        # page load), our early stub had long since been clobbered, so the
        # "fake" router silently made a real network call to the public OSRM
        # demo server. That made the test's asserted distance flaky/wrong
        # (whatever OSRM returned for the given coordinates) and dependent on
        # outbound network access from the CI runner.
        #
        # Re-injecting the stub via page.evaluate() after the page (and all
        # its scripts) has fully loaded ensures it runs last and sticks.
        #
        # The whole thing is wrapped in an IIFE for a second, unrelated
        # reason: Playwright's page.evaluate(str) auto-invokes the result of
        # evaluating the string if that result is itself a function. Without
        # the IIFE wrapper, the script's last statement -
        # `L.Routing.control = function(opts){...};` - evaluates to the
        # function value, so page.evaluate() would immediately call it with
        # no arguments. That silently pre-created window.router before the
        # real "Start Routing" click, so the click handler's
        # `if (!window.router && ...)` guard skipped both router creation
        # *and* the attachRouterEvents() call that wires up the
        # 'routesfound' listener - leaving the chase-status distance/ETA
        # stuck at '--' forever. Wrapping in an IIFE makes the completion
        # value `undefined`, so evaluate() just runs it once as intended.
        stub_script = """
            (function(){
                // Provide a minimal L.Routing.control stub that calls 'routesfound' after setWaypoints
                window._fakeLRoutingInjected = true;
                window.L = window.L || {};
                L.Routing = L.Routing || {};
                L.Routing.control = function(opts){
                    var listeners = {};
                    var ctrl = {
                        _listeners: listeners,
                        on: function(ev, cb){ listeners[ev] = cb; },
                        addTo: function(){
                            // The real Leaflet Routing Machine synchronously creates a
                            // .leaflet-routing-container in the DOM here; chase_routing.js's
                            // ensureChaseStatusBar() looks for that element to embed the
                            // Chasing/ETA/Distance readout, so the stub needs one too.
                            var container = document.querySelector('.leaflet-routing-container');
                            if (!container) {
                                container = document.createElement('div');
                                container.className = 'leaflet-routing-container';
                                document.body.appendChild(container);
                            }
                            return ctrl;
                        },
                        getPlan: function(){ return { setWaypoints: function(){} }; },
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
            })();
        """
        context.add_init_script(stub_script)

        page = context.new_page()
        page.goto(url)

        # Ensure page loaded
        time.sleep(0.5)

        # Re-apply the stub now that the real leaflet-routing-machine.min.js
        # has already run and installed its own L.Routing.control.
        page.evaluate(stub_script)

        # Inject balloon_positions and chase_car placeholders, then populate the calls dropdown
        page.evaluate("""
            window.balloon_positions = { 'TEST': { pred_marker: { getLatLng: function(){ return {lat:39.7392, lng:-104.9903}; } } } };
            window.manual_start = [40.0150, -105.2705];
            window.start_mode = 'manual';
            if (typeof populateCalls === 'function') populateCalls();
        """)

        # Click the Chase Routing button (easyButton id 'chaseRoutingButton' -
        # L.easyButton's `id` option sets an element id, not a class).
        page.click('#chaseRoutingButton')

        # Wait for modal to open. Generous timeout: this environment makes real
        # network calls (map tiles, Cesium ion) that can occasionally delay
        # main-thread work enough to make a tight timeout flaky.
        page.wait_for_selector('#chaseRoutingModal.is-open', timeout=5000)

        # Select the TEST callsign
        page.select_option('#chaseCalls', 'TEST')
        # Ensure manual mode selected and manual coords visible
        page.select_option('#startMode', 'manual')
        page.fill('#manualLat', '40.0150')
        page.fill('#manualLon', '-105.2705')

        # Click Start Routing
        page.click('#startChaseBtn')

        # Wait for the fake router to emit routesfound. The modal intentionally
        # stays open afterwards (see the "do not auto-close" comment in
        # attachRouterEvents' routesfound handler in chase_routing.js) so the
        # user can review or re-run routing; assert on the route summary and
        # re-enabled Start button instead of a modal close.
        page.wait_for_selector('#chaseRoutingModal.is-open', timeout=5000)
        page.wait_for_function(
            "document.querySelector('#chaseStatusDist').textContent.trim() !== '--'",
            timeout=5000,
        )
        assert page.locator('#chaseStatusDist').text_content().strip() == '1.2 km'
        assert page.locator('#startChaseBtn').is_enabled()

        browser.close()