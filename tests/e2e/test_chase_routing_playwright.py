import json

from playwright.sync_api import sync_playwright


def test_chase_routing_modal_and_route_creation():
    url = "http://localhost:5001/"

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context()

        # Stub the backend /api/route call so the test is deterministic and
        # network-free. chase_routing.js's fetchOsrmRoute()/applyFetchedRoute()
        # (the only routing path now - Leaflet Routing Machine was dropped in
        # favour of Cesium) read this response directly; no page-script stub
        # is needed any more since there's no L.Routing.control to fake.
        def fulfill_route(route):
            body = {
                "feature": {
                    "type": "Feature",
                    "geometry": {
                        "type": "LineString",
                        # GeoJSON [lon, lat] pairs.
                        "coordinates": [[-105.2705, 40.0150], [-104.9903, 39.7392]],
                    },
                },
                "distance_m": 1234,
                "duration_s": 600,
                "provider": "osrm",
                "provider_base": "http://stubbed-osrm.test",
                "steps": [
                    {"type": "depart", "modifier": None, "name": "Main St", "distance_m": 400, "location": [-105.2705, 40.0150]},
                    {"type": "turn", "modifier": "left", "name": "Broadway", "distance_m": 834, "location": [-105.1, 39.9]},
                    {"type": "arrive", "modifier": None, "name": "", "distance_m": 0, "location": [-104.9903, 39.7392]},
                ],
                "alternatives": [],
            }
            route.fulfill(status=200, content_type="application/json", body=json.dumps(body))

        context.route("**/api/route", fulfill_route)

        page = context.new_page()
        page.goto(url)

        # Wait for the app's own init rather than a fixed sleep.
        page.wait_for_selector("#chaseRoutingButton", timeout=5000)

        # Inject balloon_positions and chase_car placeholders, then populate the
        # calls dropdown. pred_marker is a plain [lat, lon] array (see
        # balloon_positions' data-shape comment in templates/index.html) - no
        # Leaflet marker object involved any more.
        page.evaluate("""
            window.balloon_positions = { 'TEST': { pred_marker: [39.7392, -104.9903] } };
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
        page.click('#startModeGroup .pill-toggle-btn[data-start-mode="manual"]')
        page.fill('#manualLat', '40.0150')
        page.fill('#manualLon', '-105.2705')

        # Click Start Routing
        page.click('#startChaseBtn')

        # Starting a chase closes the modal and opens the route panel instead
        # (see the startChaseBtn click handler's closeChaseRoutingModal() +
        # openRoutePanel() calls in chase_routing.js) - wait for that panel,
        # then for the stubbed route response to be applied.
        page.wait_for_selector('#routePanel.panel-open', timeout=5000)
        page.wait_for_function(
            "document.querySelector('#chaseStatusDist').textContent.trim() !== '--'",
            timeout=5000,
        )
        assert page.locator('#chaseStatusDist').text_content().strip() == '1.2 km'
        assert page.locator('#startChaseBtn').is_enabled()

        # Turn-by-turn instructions built from the stubbed steps (see
        # buildRouteInstructions/formatRouteInstruction in chase_routing.js)
        # should render in the route panel's hero card.
        page.wait_for_selector('.route-hero-title', timeout=5000)
        hero_text = page.locator('.route-hero-title').text_content()
        assert 'Broadway' in hero_text or 'Main St' in hero_text

        browser.close()
