// Chase routing UI and control
// Adds a small dialog to select a callsign to chase, a start location (GPS, manual, or chase car)
// and computes/displays car directions to the predicted landing via OSRM (see fetchOsrmRoute/applyFetchedRoute).

// Globals used by predictions.js as well
window.balloon_currently_chased = "none"; // only one callsign can be chased at a time
window.start_mode = 'chasecar'; // 'gps' | 'manual' | 'chasecar'
window.manual_start = null; // [lat, lon]
window.gps_start = null; // [lat, lon]
window.route_preference = 'fastest'; // 'fastest' | 'shortest'

// Car movement tracking for real-time route updates
window.last_route_calc_position = null; // [lat, lon] of last route calculation
window.car_movement_threshold = 100; // meters; recalculate route when car moves this distance
window.last_route_calc_time = null; // timestamp to avoid clustering recalculations

(function(){
    // Calculate great-circle distance between two points in meters using Haversine formula
    function calculateDistance(lat1, lon1, lat2, lon2){
        var R = 6371000; // Earth radius in meters
        var dLat = (lat2 - lat1) * Math.PI / 180;
        var dLon = (lon2 - lon1) * Math.PI / 180;
        var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLon/2) * Math.sin(dLon/2);
        var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c; // distance in meters
    }

    function routeDistance(r){
        var s = r.summary || r.properties || {};
        return r.distance || s.totalDistance || s.total_distance || 0;
    }
    function routeTime(r){
        var s = r.summary || r.properties || {};
        return r.duration || s.totalTime || s.total_time || 0;
    }

    // Pick which route/alternative to use, based on window.route_preference.
    // Both LRM's routesfound event and the OSRM HTTP APIs (with
    // alternatives=true) can hand back more than one candidate route -
    // 'fastest' picks the minimum-duration one (falling back to array order,
    // since OSRM already returns its primary route first), 'shortest' picks
    // the minimum-distance one. Always safe to call with a single-route
    // array (or a route missing summary fields) - just returns routes[0].
    function selectPreferredRoute(routes){
        if (!Array.isArray(routes) || routes.length === 0) return null;
        if (routes.length === 1) return routes[0];

        if (window.route_preference === 'shortest'){
            return routes.reduce(function(best, r){
                return (routeDistance(r) < routeDistance(best)) ? r : best;
            }, routes[0]);
        }
        // 'fastest' (default)
        return routes.reduce(function(best, r){
            return (routeTime(r) < routeTime(best)) ? r : best;
        }, routes[0]);
    }
    window.selectPreferredRoute = selectPreferredRoute;

    // Handle car movement to trigger route recalculation if threshold exceeded
    function handleCarMovementForRouting(){
        // Only process if actively chasing and have a valid prediction
        if (!window.balloon_currently_chased || window.balloon_currently_chased === 'none') {
            return;
        }

        // Throttle recalculations to avoid spamming router when frequent telemetry arrives
        var nowTs = Date.now();
        var minInterval = (window.car_movement_debounce_ms && typeof window.car_movement_debounce_ms === 'number') ? window.car_movement_debounce_ms : 3000; // default 3000ms
        if (window.last_route_calc_time && (nowTs - window.last_route_calc_time) < minInterval) {
            return;
        }

        // Get current car position
        if (!window.chase_car_position || !window.chase_car_position.latest_data || window.chase_car_position.latest_data.length < 2) {
            return;
        }

        var currentLat = window.chase_car_position.latest_data[0];
        var currentLon = window.chase_car_position.latest_data[1];

        // If no previous position recorded, initialize it
        if (!window.last_route_calc_position) {
            window.last_route_calc_position = [currentLat, currentLon];
            return;
        }

        // Calculate distance from last route calculation position
        var distanceMeters = calculateDistance(
            window.last_route_calc_position[0], window.last_route_calc_position[1],
            currentLat, currentLon
        );

        // If car has moved beyond threshold, recalculate route
        if (distanceMeters > window.car_movement_threshold) {
            var callsign = window.balloon_currently_chased;
            // Get current prediction landing position if available
            if (window.balloon_positions && window.balloon_positions[callsign]) {
                var predMarker = window.balloon_positions[callsign].pred_marker;
                if (Array.isArray(predMarker) && predMarker.length >= 2) {
                    var predLatlng = {lat: predMarker[0], lng: predMarker[1]};
                    // Decide whether to fully recalculate or just advance along existing route
                    var shouldRecalc = true;
                    try {
                        // if we have a current route, check destination change and off-route
                        if (window.currentChaseRouteLatLngs && window.currentChaseRouteLatLngs.length > 1 && window.last_route_destination) {
                            var destChangedDist = calculateDistance(window.last_route_destination[0], window.last_route_destination[1], predLatlng.lat, predLatlng.lng);
                            var DEST_CHANGE_THRESHOLD = window.chase_dest_change_threshold_m || 200; // meters
                            if (destChangedDist <= DEST_CHANGE_THRESHOLD) {
                                // Check if current position is still on the route
                                var nearest = getNearestVertexIndex(window.currentChaseRouteLatLngs, currentLat, currentLon);
                                var ON_ROUTE_THRESHOLD = window.chase_on_route_threshold_m || 30; // meters
                                var OFF_ROUTE_THRESHOLD = window.chase_off_route_threshold_m || 60; // meters
                                if (nearest.minDist <= ON_ROUTE_THRESHOLD) {
                                    // On route — update displayed polyline to start from current position without re-routing
                                    advanceDisplayedRouteAlongIndex(nearest.index, [currentLat, currentLon]);
                                    shouldRecalc = false;
                                } else if (nearest.minDist > OFF_ROUTE_THRESHOLD) {
                                    // Off-route — need full recalculation
                                    shouldRecalc = true;
                                } else {
                                    // Near route but ambiguous — keep existing route
                                    shouldRecalc = false;
                                }
                            }
                        }
                    } catch (e) { console.warn('Route decision error', e); }

                    if (shouldRecalc) {
                        window.updateChaseRouteIfActive(callsign, [predLatlng.lat, predLatlng.lng]);
                        // Update tracked position after successful recalculation
                        window.last_route_calc_position = [currentLat, currentLon];
                        // Record time of this recalculation to debounce further requests
                        try { window.last_route_calc_time = Date.now(); } catch(e) {}
                    } else {
                        // We updated displayed route in-place — update last calc trackers
                        window.last_route_calc_position = [currentLat, currentLon];
                        try { window.last_route_calc_time = Date.now(); } catch(e) {}
                    }
                }
            }
        }
    }

    // Make car movement handler publicly accessible for telemetry hook
    window.handleCarMovementForRouting = handleCarMovementForRouting;

    // Helper: find nearest vertex index and distance (meters) to a route (array of {lat,lng})
    function getNearestVertexIndex(latlngs, lat, lon){
        var minDist = Number.POSITIVE_INFINITY; var minIdx = -1;
        if (!Array.isArray(latlngs)) return {minDist:minDist, index:minIdx};
        for (var i=0;i<latlngs.length;i++){
            var p = latlngs[i];
            var d = calculateDistance(lat, lon, parseFloat(p.lat||p[0]||p.latitude), parseFloat(p.lng||p[1]||p.longitude));
            if (d < minDist) { minDist = d; minIdx = i; }
        }
        return {minDist: minDist, index: minIdx};
    }

    function advanceDisplayedRouteAlongIndex(idx, currentPos){
        try {
            if (!window.currentChaseRouteLatLngs || window.currentChaseRouteLatLngs.length === 0) return;
            var newPts = [];
            newPts.push([currentPos[0], currentPos[1]]);
            for (var j = idx+1; j < window.currentChaseRouteLatLngs.length; j++){
                var p = window.currentChaseRouteLatLngs[j];
                if (p && p.lat !== undefined && p.lng !== undefined) newPts.push([p.lat, p.lng]);
                else if (Array.isArray(p)) newPts.push([p[0], p[1]]);
            }
            // Update the displayed route line.
            try { if (typeof window.showChaseRouteOnCesium === 'function') window.showChaseRouteOnCesium(newPts); } catch(e){}
            // update stored route as GeoJSON too
            try { window.latestChaseRouteGeoJSON = { type:'Feature', geometry:{ type:'LineString', coordinates: newPts.map(function(a){ return [a[1], a[0]]; }) }, properties: { updatedBy: 'advance' } }; pushLatestRouteToServer(window.latestChaseRouteGeoJSON); } catch(e){}
            // The route itself didn't change, just how far along it the car
            // is - refresh the panel's passed/next-turn state either way.
            if (typeof window.renderRoutePanel === 'function') { window.renderRoutePanel(); }
        } catch (e) { console.warn('advanceDisplayedRouteAlongIndex error', e); }
    }

    // The chase-status elements (#chaseStatusCall/ETA/Dist) are a data store
    // read by renderRoutingActivePill()/renderRoutePanel() - the visible
    // "routing active" summary is the topbar pill (#routingActivePill), so
    // this bar itself stays hidden rather than floating over the map.
    function ensureChaseStatusBar(){
        if ($('#chase-status').length) return;
        var $bar = $(
            "<div id='chase-status' class='chase-status-inline' style='display:none;'>" +
                "<span class='chase-status-item'><strong>Chasing:</strong> <span id='chaseStatusCall'>None</span></span>" +
                "<span class='chase-status-item'><strong>ETA:</strong> <span id='chaseStatusETA'>--</span></span>" +
                "<span class='chase-status-item'><strong>Distance:</strong> <span id='chaseStatusDist'>--</span></span>" +
            "</div>"
        );
        $('body').append($bar);
    }

    function updateChaseRoutingSubtitle(){
        var cs = $('#chaseCalls').val();
        $('#chaseRoutingSubtitle').text(cs ? ('to ' + cs + ' (live balloon position)') : 'Select a callsign to chase');
    }
    window.updateChaseRoutingSubtitle = updateChaseRoutingSubtitle;

    function openChaseRoutingModal(){
        var $modal = $('#chaseRoutingModal');
        var $card = $modal.find('.chase-routing-modal-card');
        populateCalls();
        updateChaseRoutingSubtitle();
        $modal.addClass('is-open').attr('aria-hidden','false');
        $card.removeClass('modal-closing modal-opened').addClass('modal-opening');
        window.requestAnimationFrame(function(){ $card.removeClass('modal-opening').addClass('modal-opened'); });
    }

    window.openChaseRoutingModal = openChaseRoutingModal;

    function closeChaseRoutingModal(){
        var $modal = $('#chaseRoutingModal');
        var $card = $modal.find('.chase-routing-modal-card');
        $card.removeClass('modal-opening modal-opened').addClass('modal-closing');
        $card.one('transitionend', function(){ $modal.removeClass('is-open').attr('aria-hidden','true'); $card.removeClass('modal-closing'); });
        window.setTimeout(function(){ if ($modal.hasClass('is-open')) { $modal.removeClass('is-open').attr('aria-hidden','true'); $card.removeClass('modal-closing'); } }, 420);
    }

    window.closeChaseRoutingModal = closeChaseRoutingModal;

    function ensureDialog(){
        var $modal = $('#chaseRoutingModal');
        if ($modal.length === 0) return; // modal should be in template

        // Attach handlers once
        if ($modal.data('chase-initialized')) return;
        $modal.data('chase-initialized', true);

        function setStartModePillActive(mode){
            $('#startModeGroup .pill-toggle-btn').removeClass('is-active');
            $('#startModeGroup .pill-toggle-btn[data-start-mode="' + mode + '"]').addClass('is-active');
        }

        function requestGpsStart(){
            if (!navigator.geolocation){
                $('#gpsStatus').text('Geolocation not supported');
                return;
            }
            $('#gpsStatus').text('Getting...');
            $('#getGPSBtn').show();
            navigator.geolocation.getCurrentPosition(function(pos){
                window.gps_start = [pos.coords.latitude, pos.coords.longitude];
                $('#gpsStatus').text('GPS obtained.');
            }, function(err){
                $('#gpsStatus').text('GPS error: ' + err.message);
            }, {enableHighAccuracy:true, timeout:10000});
        }

        $('#startModeGroup .pill-toggle-btn').on('click', function(){
            var v = $(this).data('start-mode');
            window.start_mode = v;
            setStartModePillActive(v);
            $('#manualStartDiv').toggle(v === 'manual');
            $('#getGPSBtn').toggle(v === 'gps');
            if (v === 'gps') { requestGpsStart(); } else { $('#gpsStatus').text(''); }
        });

        $('#routePreferenceGroup .pill-toggle-btn').on('click', function(){
            var v = $(this).data('route-preference');
            $('#routePreferenceGroup .pill-toggle-btn').removeClass('is-active');
            $(this).addClass('is-active');
            if (typeof window.setRoutePreference === 'function') window.setRoutePreference(v);
        });

        $('#setManualStart').on('click', function(){
            var la = parseFloat($('#manualLat').val());
            var lo = parseFloat($('#manualLon').val());
            if (!isNaN(la) && !isNaN(lo)){
                window.manual_start = [la, lo];
                $('#gpsStatus').text('Manual start set.');
            } else {
                $('#gpsStatus').text('Invalid manual coords');
            }
        });

        $('#getGPSBtn').on('click', requestGpsStart);

        $('#chaseCalls').on('change', function(){
            if (typeof window.updateChaseRoutingSubtitle === 'function') window.updateChaseRoutingSubtitle();
        });

        $('#startChaseBtn').on('click', function(){
            var cs = $('#chaseCalls').val();
            if (!cs){ $('#gpsStatus').text('Select a callsign'); return; }
            window.balloon_currently_chased = cs;
            ensureChaseStatusBar();

            closeChaseRoutingModal();
            if (typeof window.openRoutePanel === 'function') window.openRoutePanel();

            var _pm = (balloon_positions[cs] && balloon_positions[cs].pred_marker) ? balloon_positions[cs].pred_marker : null;
            var pred_marker = (Array.isArray(_pm) && _pm.length >= 2) ? {lat: _pm[0], lng: _pm[1]} : null;
            if (pred_marker == null){
                $('#gpsStatus').text('No prediction yet; will update when available');
                if (typeof window.showAppToast === 'function') window.showAppToast('Chase started; waiting for prediction');
                $('#chase-status').show();
                $('#chaseStatusCall').text(cs);
                return;
            }

            // Show loading spinner and disable Start button while router computes
            try { $('#chaseRoutingSpinner').show(); } catch(e){}
            try { $('#startChaseBtn').prop('disabled', true); } catch(e){}
            $('#gpsStatus').text('Routing started; waiting for computed route');
            if (typeof window.showAppToast === 'function') window.showAppToast('Routing started; computing...');

            // Start a timeout to fail gracefully if no route is found
            if (window._chase_route_timer) { clearTimeout(window._chase_route_timer); window._chase_route_timer = null; }
            window._chase_route_timer = setTimeout(function(){
                try { $('#chaseRoutingSpinner').hide(); $('#startChaseBtn').prop('disabled', false); } catch(e){}
                $('#gpsStatus').text('Routing timeout');
                if (typeof window.showAppToast === 'function') window.showAppToast('Routing timeout');
            }, window.chase_route_timeout_ms || 8000);

            setRouteToPrediction(cs, pred_marker);
            $('#chase-status').show();
            $('#chaseStatusCall').text(cs);
        });

        $('#stopChaseBtn').on('click', function(){
            window.balloon_currently_chased = 'none';
            window.last_route_calc_position = null;
            window.currentSelectedRoute = null;
            window.currentRouteAlternatives = null;
            if (typeof window.clearChaseRouteOnCesium === 'function') {
                try { window.clearChaseRouteOnCesium(); } catch (e) {}
            }
            $('#chaseStatusCall').text('None');
            $('#chaseStatusETA').text('--');
            $('#chaseStatusDist').text('--');
            $('#chase-status').hide();
            closeChaseRoutingModal();
            if (typeof window.closeRoutePanel === 'function') window.closeRoutePanel();
            if (typeof window.renderRoutingActivePill === 'function') window.renderRoutingActivePill();
        });

        // Close modal on backdrop click or the Cancel button (both carry
        // data-chase-routing-close).
        $modal.on('click', '[data-chase-routing-close]', function(){ closeChaseRoutingModal(); });
    }

    function populateCalls(){
        var sel = $('#chaseCalls');
        var current = sel.val();
        sel.empty();
        for (var cs in balloon_positions){
            if (!balloon_positions.hasOwnProperty(cs)) continue;
            sel.append($('<option>').attr('value', cs).text(cs));
        }
        // Re-opening the modal mid-chase (or re-populating after a fresh
        // APRS/telemetry frame) should keep the callsign already selected
        // rather than silently reverting to whichever option sorts first.
        var preferred = (window.balloon_currently_chased && window.balloon_currently_chased !== 'none')
            ? window.balloon_currently_chased : current;
        if (preferred && balloon_positions.hasOwnProperty(preferred)){
            sel.val(preferred);
        }
    }

    function setRouteToPrediction(callsign, predLatLng){
        if (!predLatLng){
            // no prediction yet; leave waypoints cleared until prediction arrives
            return;
        }
        ensureChaseStatusBar();

        var startLat, startLon;
        if (window.start_mode === 'chasecar' && chase_car_position && Array.isArray(chase_car_position.latest_data) && chase_car_position.latest_data.length >= 2){
            startLat = chase_car_position.latest_data[0]; startLon = chase_car_position.latest_data[1];
        } else if (window.start_mode === 'manual' && window.manual_start){
            startLat = window.manual_start[0]; startLon = window.manual_start[1];
        } else if (window.start_mode === 'gps' && window.gps_start){
            startLat = window.gps_start[0]; startLon = window.gps_start[1];
        } else {
            startLat = chase_config.default_lat; startLon = chase_config.default_lon;
        }

        window.last_route_calc_position = [startLat, startLon];
        fetchOsrmRoute(startLat, startLon, predLatLng.lat, predLatLng.lng);

        // Update status panel to show active chased callsign
        $('#chase-status').show();
        $('#chaseStatusCall').text(callsign);
    }

    // Turn a step's [lon,lat] maneuver location into an index into `latlngs`
    // (the route's own coordinate list), matching the `.index` field
    // formatRouteInstruction()/isInstrPassed() use to track which turns the
    // car has already passed.
    function locateStepIndex(step, latlngs){
        if (!step || !Array.isArray(step.location) || step.location.length !== 2){
            return -1;
        }
        return getNearestVertexIndex(latlngs, step.location[1], step.location[0]).index;
    }

    // route.steps is the backend's normalized shape (see _normalize_osrm_steps
    // in horusmapper.py / normalizeOsrmSteps() below): [{type, modifier, name,
    // distance_m, location}, ...]. Turn it into the {type, modifier, road,
    // distance, index} shape formatRouteInstruction()/routeTurnIconSvg()/
    // isInstrPassed() read.
    function buildRouteInstructions(steps, latlngs){
        if (!Array.isArray(steps)) return [];
        return steps.map(function(step){
            return {
                type: step.type,
                modifier: step.modifier,
                road: step.name,
                distance: step.distance_m,
                index: locateStepIndex(step, latlngs)
            };
        });
    }

    function applyFetchedRoute(route, sourceLabel){
        window.currentSelectedRoute = route;
        var coords = route.geometry.coordinates; // [lon,lat]
        var latlngs = coords.map(function(c){ return [c[1], c[0]]; });
        route.instructions = buildRouteInstructions(route.steps, latlngs);
        // populate currentChaseRouteLatLngs for in-place advancement
        window.currentChaseRouteLatLngs = latlngs.map(function(ll){ return {lat: ll[0], lng: ll[1]}; });
        window.last_route_destination = [latlngs[latlngs.length-1][0], latlngs[latlngs.length-1][1]];

        // Store GeoJSON for mobile compatibility
        try {
            window.latestChaseRouteGeoJSON = {
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: latlngs.map(function(ll){ return [ll[1], ll[0]]; }) },
                properties: { source: sourceLabel || 'osrm-fallback' }
            };
            pushLatestRouteToServer(window.latestChaseRouteGeoJSON);
        } catch(e) {}

        // Update chase-status with distance/time
        try {
            var dist = route.distance || 0; var time = route.duration || 0;
            var distText = (dist >= 1000) ? ((dist/1000).toFixed(1) + ' km') : (Math.round(dist) + ' m');
            $('#chaseStatusDist').text(distText);
            $('#chaseStatusETA').text(formatTimeSeconds(time));
        } catch(e){}

        // Mirror to Cesium if available
        try { if (typeof window.showChaseRouteOnCesium === 'function') window.showChaseRouteOnCesium(latlngs); } catch(e){}

        // Stop spinner and restore UI (do not auto-close modal)
        try {
            if (window._chase_route_timer) { clearTimeout(window._chase_route_timer); window._chase_route_timer = null; }
            $('#chaseRoutingSpinner').hide();
            $('#startChaseBtn').prop('disabled', false);
            if (typeof window.showAppToast === 'function') window.showAppToast('Route ready');
        } catch(e) { console.warn('OSRM fallback UI restore error', e); }
        if (typeof window.renderRoutePanel === 'function') { window.renderRoutePanel(); }
        if (typeof window.renderRoutingActivePill === 'function') { window.renderRoutingActivePill(); }
    }

    // Route fetch helper: prefer backend /api/route, fallback to direct OSRM
    //
    // Overlapping calls are possible on a flaky connection - a slow/retried
    // request can still be in flight when a newer one starts (e.g. triggered
    // by car movement). Without sequencing, an older response resolving after
    // a newer one would silently overwrite applyFetchedRoute()'s state with a
    // stale route. _routeFetchSeq tracks the most recently *started* call, and
    // each in-flight request checks it still owns that number before applying
    // its result.
    var _routeFetchSeq = 0;

    // Client-side port of horusmapper.py's _normalize_osrm_steps() - used only
    // for the direct-OSRM fallback below, where the raw OSRM response (rather
    // than the backend's already-normalized `steps` field) is all we have.
    function normalizeOsrmSteps(route){
        var stepsOut = [];
        (route.legs || []).forEach(function(leg){
            (leg.steps || []).forEach(function(step){
                var maneuver = step.maneuver || {};
                var loc = maneuver.location;
                stepsOut.push({
                    type: maneuver.type,
                    modifier: maneuver.modifier,
                    name: step.name || '',
                    distance_m: step.distance || 0,
                    location: (Array.isArray(loc) && loc.length === 2) ? loc : null
                });
            });
        });
        return stepsOut;
    }

    function fetchOsrmRoute(startLat, startLon, endLat, endLon){
        var _seq = ++_routeFetchSeq;
        fetch('/api/route', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ start_lat: startLat, start_lon: startLon, end_lat: endLat, end_lon: endLon })
        }).then(function(resp){
            if (!resp.ok) throw new Error('Backend route failed: ' + resp.status);
            return resp.json();
        }).then(function(j){
            if (_seq !== _routeFetchSeq) return; // superseded by a newer route request
            if (!j || !j.feature || !j.feature.geometry || !j.feature.geometry.coordinates) {
                throw new Error('Invalid backend route response');
            }
            var route = {
                geometry: j.feature.geometry,
                distance: j.distance_m || 0,
                duration: j.duration_s || 0,
                steps: j.steps
            };
            applyFetchedRoute(route, 'osrm-backend');
        }).catch(function(backendErr){
            if (_seq !== _routeFetchSeq) return;
            console.warn('Backend routing failed, trying direct OSRM', backendErr);
            var base = window.osrm_base || 'https://router.project-osrm.org/route/v1/driving/';
            var url = base + startLon + ',' + startLat + ';' + endLon + ',' + endLat + '?overview=full&geometries=geojson&annotations=distance,duration&alternatives=true&steps=true';
            fetch(url).then(function(resp){ return resp.json(); }).then(function(j){
                if (_seq !== _routeFetchSeq) return;
                if (!j || !j.routes || j.routes.length === 0) { throw new Error('No routes'); }
                window.currentRouteAlternatives = j.routes;
                var selected = selectPreferredRoute(j.routes);
                selected.steps = normalizeOsrmSteps(selected);
                applyFetchedRoute(selected, 'osrm-fallback');
            }).catch(function(err){
                if (_seq !== _routeFetchSeq) return;
                console.warn('OSRM fallback failed', err);
                try { $('#gpsStatus').text('Routing failed'); if (typeof window.showAppToast === 'function') window.showAppToast('Routing failed'); } catch(e){}
                try {
                    $('#chaseRoutingSpinner').hide();
                    $('#startChaseBtn').prop('disabled', false);
                } catch(e){}
            });
        });
    }
    window.fetchOsrmRoute = fetchOsrmRoute;

    // Push latest route GeoJSON to server for mobile/native clients
    function pushLatestRouteToServer(geojson){
        try{
            if (!geojson || !window.fetch) return;
            fetch('/api/latest_route', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(geojson) }).then(function(resp){
                if (!resp.ok) console.warn('Failed to push latest route to server', resp.status);
            }).catch(function(e){ console.warn('Push latest route failed', e); });
        }catch(e){ console.warn('pushLatestRouteToServer error', e); }
    }

    // Download utilities for Export Route button
    function downloadText(filename, text){
        var blob = new Blob([text], {type: 'application/octet-stream'});
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    }

    function geojsonToKml(geojson){
        try{
            var coords = geojson.geometry.coordinates; // [lon,lat]
            var kml = '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>Chase Route</name><LineString><tessellate>1</tessellate><coordinates>\n';
            coords.forEach(function(c){ kml += c[0] + ',' + c[1] + ',0\n'; });
            kml += '</coordinates></LineString></Placemark></Document></kml>';
            return kml;
        }catch(e){ console.warn('KML conversion failed', e); return null; }
    }

    // Wire export button
    $(document).on('click', '#exportRouteBtn', function(){
        if (!window.latestChaseRouteGeoJSON){
            // try fetching from server
            fetch('/api/latest_route').then(function(r){ if (!r.ok) { $('#gpsStatus').text('No route to export'); return; } return r.json(); }).then(function(j){ if (!j) return; window.latestChaseRouteGeoJSON = j; doExport(window.latestChaseRouteGeoJSON); }).catch(function(){ $('#gpsStatus').text('No route to export'); });
            return;
        }
        doExport(window.latestChaseRouteGeoJSON);
    });

    function doExport(geojson){
        try{
            var name = 'chase_route_' + (new Date()).toISOString().replace(/[:.]/g,'-');
            downloadText(name + '.geojson', JSON.stringify(geojson, null, 2));
            var kml = geojsonToKml(geojson);
            if (kml) downloadText(name + '.kml', kml);
            if (typeof window.showAppToast === 'function') window.showAppToast('Route exported');
        }catch(e){ console.warn('Export failed', e); }
    }

    // Switch Fastest/Shortest preference. If a chase is already in progress,
    // re-requests the route (with the same start/destination) so LRM/OSRM's
    // alternatives get re-evaluated under the new preference - the
    // routesfound handler above then picks the matching alternative.
    window.setRoutePreference = function(pref){
        window.route_preference = (pref === 'shortest') ? 'shortest' : 'fastest';
        var cs = window.balloon_currently_chased;
        if (!cs || cs === 'none') return;
        var predMarker = (window.balloon_positions && window.balloon_positions[cs]) ? window.balloon_positions[cs].pred_marker : null;
        if (predMarker && typeof predMarker.getLatLng === 'function'){
            setRouteToPrediction(cs, predMarker.getLatLng());
        }
    };

    // Public helper used by prediction updates to refresh route when prediction becomes available
    window.updateChaseRouteIfActive = function(callsign, predLanding){
        if (window.balloon_currently_chased && window.balloon_currently_chased === callsign){
            if (predLanding && predLanding.length >= 2){
                setRouteToPrediction(callsign, {lat: predLanding[0], lng: predLanding[1]});
            }
        }
    };

    // ---------------------------------------------------------------------
    // Route panel (full turn-by-turn) + routing-active stop pill.
    // Reads window.currentSelectedRoute / window.currentRouteAlternatives,
    // populated by applyFetchedRoute() above.
    // ---------------------------------------------------------------------

    var ROUTE_ARROW_ICON = '<line x1="12" y1="19" x2="12" y2="6"></line><path d="M7 11 L12 6 L17 11"></path>';
    var ROUTE_ARRIVE_ICON = '<path d="M6 3v18"></path><path d="M6 4h11l-3 4 3 4H6"></path>';

    function classifyInstruction(instr){
        var t = (instr && instr.type) || '';
        var m = (instr && instr.modifier) || '';
        if (t === 'arrive') return 'arrive';
        if (/left/i.test(m)) return 'left';
        if (/right/i.test(m)) return 'right';
        return 'straight';
    }

    function routeTurnIconSvg(instr, color, size){
        var kind = classifyInstruction(instr);
        var rotate = kind === 'right' ? ' transform="rotate(90 12 12)"' : (kind === 'left' ? ' transform="rotate(-90 12 12)"' : '');
        var inner = kind === 'arrive' ? ROUTE_ARRIVE_ICON : ROUTE_ARROW_ICON;
        var wrapped = rotate ? ('<g' + rotate + '>' + inner + '</g>') : inner;
        var dim = size || 15;
        return '<svg width="' + dim + '" height="' + dim + '" viewBox="0 0 24 24" fill="none" stroke="' + color + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + wrapped + '</svg>';
    }

    // Builds a human instruction string ("Continue on County Rd 12", "Turn
    // left onto Territorial Rd") from OSRM's raw type/modifier/road fields -
    // mirrors mobile's stepHeadline() (mobile/src/screens/route/RouteScreen.tsx),
    // which reads the same backend-normalized step shape.
    function formatRouteInstruction(instr){
        if (!instr) return '';
        if (instr.type === 'arrive') return 'Arrive near balloon (est.)';
        var mod = instr.modifier || '';
        if (mod.indexOf('left') !== -1) return instr.road ? ('Turn left onto ' + instr.road) : 'Turn left';
        if (mod.indexOf('right') !== -1) return instr.road ? ('Turn right onto ' + instr.road) : 'Turn right';
        if (instr.type === 'depart') return instr.road ? ('Head out on ' + instr.road) : 'Head out';
        return instr.road ? ('Continue on ' + instr.road) : 'Continue straight';
    }

    function formatRouteDistance(m){
        if (!m && m !== 0) return '';
        return (m >= 1000) ? ((m / 1000).toFixed(1) + ' km') : (Math.round(m) + ' m');
    }

    // An instruction counts as "passed" once the car's nearest route vertex
    // is at or beyond it - except the final instruction (arrival), which
    // stays as the fallback "next" step so there's always something to show.
    function isInstrPassed(instr, i, passedIdx, total){
        return typeof instr.index === 'number' && instr.index <= passedIdx && i < total - 1;
    }

    function getRoutePassedIndex(){
        if (!window.currentChaseRouteLatLngs || !window.currentChaseRouteLatLngs.length) return -1;
        if (!window.chase_car_position || !Array.isArray(window.chase_car_position.latest_data) || window.chase_car_position.latest_data.length < 2) return -1;
        var nearest = getNearestVertexIndex(window.currentChaseRouteLatLngs, window.chase_car_position.latest_data[0], window.chase_car_position.latest_data[1]);
        return nearest.index;
    }

    var route_panel_show_passed = false;
    var route_panel_open = false;
    var route_panel_collapsed = false;

    function renderRoutingActivePill(){
        var $pill = $('#routingActivePill');
        if ($pill.length === 0) return;
        var cs = window.balloon_currently_chased;
        if (!cs || cs === 'none' || route_panel_open){
            $pill.hide().empty();
            return;
        }
        var eta = $('#chaseStatusETA').length ? $('#chaseStatusETA').text() : '--';
        $pill.html(
            '<span class="routing-active-dot"></span>' +
            '<div class="routing-active-text">' +
                '<div class="routing-active-title">Routing active</div>' +
                '<div class="routing-active-sub mono">to ' + escapeHtml(cs) + ' &middot; ' + escapeHtml(eta || '--') + '</div>' +
            '</div>' +
            '<button type="button" class="routing-active-stop-btn" id="routingActivePillStopBtn">Stop</button>'
        ).show();
        keepRoutingPillClearOfTelemCard();
    }
    window.renderRoutingActivePill = renderRoutingActivePill;

    // #routingActivePill and #telemReadoutCard both anchor bottom-left, and
    // the pill's CSS bottom offset (see .routing-active-pill) assumes a fixed
    // telem-card height - but that card's actual height varies with its
    // content (a long callsign wraps, DIST/ETA go from "--" to real values,
    // etc.), so a purely CSS-based fixed gap can't reliably clear it; on a
    // tall enough card the two visibly overlap. Measures the real on-screen
    // geometry instead of guessing, and only ever pushes the pill *up* from
    // its CSS-defined resting position - never down - so a short/absent telem
    // card keeps the originally tuned spacing untouched.
    function keepRoutingPillClearOfTelemCard(){
        var pillEl = document.getElementById('routingActivePill');
        var telemEl = document.getElementById('telemReadoutCard');
        if (!pillEl || getComputedStyle(pillEl).display === 'none') return;

        // Clear any previous correction before measuring, so this always
        // compares against the pill's real CSS-defined position, not a stale
        // correction left over from a taller telem card a moment ago.
        pillEl.style.bottom = '';
        if (!telemEl || getComputedStyle(telemEl).display === 'none') return;

        var pillRect = pillEl.getBoundingClientRect();
        var telemRect = telemEl.getBoundingClientRect();
        var overlap = pillRect.bottom - telemRect.top;
        if (overlap > 0){
            var gap = 12;
            pillEl.style.bottom = (parseFloat(getComputedStyle(pillEl).bottom) + overlap + gap) + 'px';
        }
    }

    // The telem card's height can also change independently of the pill
    // itself re-rendering (e.g. its DIST/ETA text updating on a telemetry
    // tick) - a short interval catches that without needing to hook every
    // call site that might resize it.
    setInterval(keepRoutingPillClearOfTelemCard, 1000);

    $(document).on('click', '#routingActivePillStopBtn', function(e){
        e.stopPropagation();
        $('#stopChaseBtn').trigger('click');
    });
    $(document).on('click', '#routingActivePill', function(e){
        if ($(e.target).closest('#routingActivePillStopBtn').length) return;
        openRoutePanel();
    });

    function openRoutePanel(){
        // Route and APRS/Log/Settings are mutually-exclusive screens (see
        // the matching comment in toggleSettingsPanel()/toggleLogPanel() in
        // index.html) - close whichever of those is open so this panel
        // replaces it instead of rendering on top of it.
        if (typeof window.closePanel === 'function'){
            window.closePanel($('#logPanel'));
            window.closePanel($('#settingsPanel'));
        }

        route_panel_open = true;
        route_panel_collapsed = false;
        renderRoutePanel();
        renderRoutingActivePill();
        if (typeof window.openPanelWithAnimation === 'function'){
            window.openPanelWithAnimation($('#routePanel'));
        } else {
            $('#routePanel').addClass('panel-open');
        }
        // On mobile the route panel is a full-screen takeover (see the
        // @media(max-width:720px) rule for .route-panel) - hide the other
        // floating map chrome (DOA pill, zoom/3D/locate controls) that would
        // otherwise render on top of it, since Cesium's "moved" control
        // container uses a z-index above everything else on the page.
        $('body').addClass('route-panel-active');
        if (typeof window.setTopbarSelection === 'function') window.setTopbarSelection('route');
    }
    window.openRoutePanel = openRoutePanel;

    function closeRoutePanel(){
        route_panel_open = false;
        if (typeof window.closePanel === 'function'){
            window.closePanel($('#routePanel'));
        } else {
            $('#routePanel').removeClass('panel-open');
        }
        $('#routePanelFooter').hide().empty();
        $('body').removeClass('route-panel-active');
        renderRoutingActivePill();
        if (typeof window.setTopbarSelection === 'function') window.setTopbarSelection('track');
    }
    window.closeRoutePanel = closeRoutePanel;
    window.isRoutePanelOpen = function(){ return route_panel_open; };

    // The chevron collapses the panel down to just the hero "next turn" card
    // + a full-width footer bar (matching the design's compact Route view),
    // rather than closing it - the panel only actually closes via the
    // topbar Route pill or Stop.
    $(document).on('click', '#routePanel .route-panel-collapse-btn', function(){
        route_panel_collapsed = !route_panel_collapsed;
        renderRoutePanel();
    });

    $(document).on('click', '#routePanel .route-stops-passed-row', function(){
        route_panel_show_passed = !route_panel_show_passed;
        renderRoutePanel();
    });

    $(document).on('click', '#routePanel .route-alt-pill', function(){
        var pref = $(this).data('route-preference');
        if (pref && typeof window.setRoutePreference === 'function') window.setRoutePreference(pref);
    });

    function renderRoutePanel(){
        var $panel = $('#routePanel');
        if ($panel.length === 0) return;

        // Default the floating footer to hidden on every call - only the one
        // branch below that actually wants it shown (collapsed AND open) is
        // responsible for re-showing it. Every other return path (not
        // chasing, no route yet, expanded) then self-heals for free instead
        // of needing its own "and don't forget to hide the footer" line -
        // see the comment further down on why that matters (closeRoutePanel()
        // never resets route_panel_collapsed, so a stale collapsed footer can
        // otherwise reappear from an unrelated background re-render after the
        // panel's been closed).
        $('#routePanelFooter').hide().empty();

        var cs = window.balloon_currently_chased;
        if (!cs || cs === 'none'){
            $panel.empty();
            return;
        }

        $panel.toggleClass('is-collapsed', route_panel_collapsed);

        var route = window.currentSelectedRoute;
        var alternatives = window.currentRouteAlternatives || (route ? [route] : []);

        // No separate "Route" title bar (the design doesn't have one) - the
        // target row below doubles as the panel header, with the collapse
        // toggle tucked into its corner.

        // Best-effort ALT/descent readout for the routed callsign: reuses the
        // telemetry card's already-current text rather than re-deriving it from
        // scratch, since the routed payload is normally also the followed one.
        // #telemReadoutAlt already carries an "ALT " prefix baked into its text
        // (see updateTelemReadout in balloon.js); strip it back off so the
        // label can be styled separately from the value here, matching the
        // design's two label+value stat pairs.
        var targetAltValue = $('#telemReadoutAlt').text().replace(/^ALT\s*/i, '').trim();
        var targetDescValue = $('#telemReadoutDescent').text().trim();
        var targetStatsHtml = '';
        if (targetAltValue && targetAltValue !== '—') {
            targetStatsHtml += '<div class="route-target-stat"><span class="route-target-stat-label">ALT</span> <span class="route-target-stat-value mono">' + escapeHtml(targetAltValue) + '</span></div>';
        }
        if (targetDescValue && targetDescValue !== '—') {
            targetStatsHtml += '<div class="route-target-stat"><span class="route-target-stat-label">DESC</span> <span class="route-target-stat-value route-target-stat-value--accent mono">' + escapeHtml(targetDescValue) + '</span></div>';
        }
        var targetRowHtml = '<div class="route-target-row">' +
            '<span class="route-target-callsign mono">' + escapeHtml(cs) + '</span>' +
            '<div class="route-target-row-right">' +
                (targetStatsHtml ? '<div class="route-target-stats">' + targetStatsHtml + '</div>' : '') +
                '<button type="button" class="route-panel-collapse-btn" aria-label="' + (route_panel_collapsed ? 'Expand' : 'Collapse') + '">' +
                    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(' + (route_panel_collapsed ? '180' : '0') + 'deg)"><path d="M6 9l6 6 6-6"></path></svg>' +
                '</button>' +
            '</div>' +
        '</div>';

        var altPillsHtml = '';
        if (alternatives.length > 1){
            var fastest = alternatives.reduce(function(b, r){ return routeTime(r) < routeTime(b) ? r : b; }, alternatives[0]);
            var shortest = alternatives.reduce(function(b, r){ return routeDistance(r) < routeDistance(b) ? r : b; }, alternatives[0]);
            altPillsHtml = '<div class="route-alt-pills">' +
                '<button type="button" class="route-alt-pill' + (window.route_preference !== 'shortest' ? ' is-active' : '') + '" data-route-preference="fastest">Fastest &middot; ' + formatTimeSeconds(routeTime(fastest)) + '</button>' +
                '<button type="button" class="route-alt-pill' + (window.route_preference === 'shortest' ? ' is-active' : '') + '" data-route-preference="shortest">Shortest &middot; ' + formatTimeSeconds(routeTime(shortest)) + '</button>' +
            '</div>';
        }

        if (!route){
            $panel.html(targetRowHtml + altPillsHtml + '<div class="route-panel-waiting">Calculating route&hellip;</div>');
            return;
        }

        var instructions = route.instructions || [];
        var passedIdx = getRoutePassedIndex();
        var passedCount = 0;
        var nextIdx = -1;
        $.each(instructions, function(i, instr){
            if (isInstrPassed(instr, i, passedIdx, instructions.length)){
                passedCount++;
            } else if (nextIdx === -1){
                nextIdx = i;
            }
        });
        if (nextIdx === -1 && instructions.length) nextIdx = instructions.length - 1;

        var heroHtml = '';
        if (instructions.length){
            var nextInstr = instructions[nextIdx];
            var afterText = (nextIdx + 1 < instructions.length) ? (' &middot; then ' + formatRouteInstruction(instructions[nextIdx + 1], nextIdx + 1).toLowerCase()) : '';
            heroHtml = '<div class="route-hero-card">' +
                '<div class="route-hero-icon">' + routeTurnIconSvg(nextInstr, '#FFCB05', 18) + '</div>' +
                '<div class="route-hero-text">' +
                    '<div class="route-hero-title">' + escapeHtml(formatRouteInstruction(nextInstr, nextIdx)) + '</div>' +
                    '<div class="route-hero-sub mono">' + formatRouteDistance(nextInstr.distance) + afterText + '</div>' +
                '</div>' +
            '</div>';
        }

        var passedRowHtml = '';
        if (passedCount > 0){
            passedRowHtml = '<div class="route-stops-passed-row">' +
                '<span>' + passedCount + ' stop' + (passedCount === 1 ? '' : 's') + ' passed</span>' +
                '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="route-stops-passed-chevron' + (route_panel_show_passed ? ' is-open' : '') + '"><path d="M9 6l6 6-6 6"></path></svg>' +
            '</div>';
        }

        var listHtml = '<div class="route-turn-list">';
        $.each(instructions, function(i, instr){
            var isPassed = isInstrPassed(instr, i, passedIdx, instructions.length);
            if (isPassed && !route_panel_show_passed) return; // stays collapsed under the "N stops passed" row
            var isNext = (i === nextIdx);
            var rowClass = 'route-turn-row' + (isNext ? ' is-next' : '') + (isPassed ? ' is-passed' : '');
            listHtml += '<div class="' + rowClass + '">' +
                '<div class="route-turn-icon">' + routeTurnIconSvg(instr, isNext ? '#FFCB05' : (isPassed ? 'rgba(230,238,246,.35)' : '#e6eef6')) + '</div>' +
                '<div class="route-turn-text">' + escapeHtml(formatRouteInstruction(instr, i)) + '</div>' +
                '<div class="route-turn-dist mono">' + formatRouteDistance(instr.distance) + '</div>' +
            '</div>';
        });
        listHtml += '</div>';

        var dist = routeDistance(route);
        var time = routeTime(route);
        var balloonEtaText = $('#telemReadoutEta').length ? $('#telemReadoutEta').text() : '--';

        var footerInnerHtml =
            '<div class="route-footer-stats">' +
                '<div class="route-stat"><div class="route-stat-label">DRIVE ETA</div><div class="route-stat-value route-stat-value--accent mono">' + formatTimeSeconds(time) + '</div></div>' +
                '<div class="route-stat"><div class="route-stat-label">BALLOON ETA</div><div class="route-stat-value mono route-stat-value--maize">' + escapeHtml(balloonEtaText) + '</div></div>' +
                '<div class="route-stat"><div class="route-stat-label">DIST</div><div class="route-stat-value mono">' + formatRouteDistance(dist) + '</div></div>' +
            '</div>' +
            '<button type="button" class="route-cta-btn" id="routeCtaBtn">Get there before it lands</button>';

        // The collapsed state's footer renders into #routePanelFooter (a
        // plain body-level sibling) instead of inside #routePanel, since
        // #routePanel's own backdrop-filter would otherwise make
        // position:fixed on a nested footer position relative to its box
        // instead of the viewport (same reasoning as #doaBearingPanel).
        //
        // Also gated on route_panel_open (not just route_panel_collapsed):
        // closeRoutePanel() hides this footer but never resets
        // route_panel_collapsed, so without this check a background
        // re-render (e.g. the route recalculating as the car moves - see
        // advanceDisplayedRouteAlongIndex/fetchOsrmRoute's own
        // renderRoutePanel() calls, both unconditional on panel-open state)
        // would silently reshow the stale collapsed footer on top of
        // #routingActivePill/#telemReadoutCard after navigating away from
        // the Route panel while still routing.
        if (route_panel_collapsed && route_panel_open){
            $('#routePanelFooter').html('<div class="route-panel-footer">' + footerInnerHtml + '</div>').show();
            $panel.html(targetRowHtml + altPillsHtml + heroHtml);
        } else {
            // Footer already defaulted to hidden at the top of this function.
            $panel.html(targetRowHtml + altPillsHtml + heroHtml + passedRowHtml + listHtml + '<div class="route-panel-footer">' + footerInnerHtml + '</div>');
        }
    }
    window.renderRoutePanel = renderRoutePanel;

    $(document).on('click', '#routeCtaBtn', function(){
        // Re-center the map on the chase car, same helper the other side
        // panels use to keep their content clear of the map focus point.
        if (window.last_route_calc_position && typeof window.panMapToVisibleCenter === 'function'){
            window.panMapToVisibleCenter(window.last_route_calc_position);
        }
    });

    function formatTimeSeconds(sec){
        if (!sec || sec <= 0) return '--';
        var s = Math.round(sec);
        var h = Math.floor(s/3600); s = s%3600; var m = Math.floor(s/60); var ss = s%60;
        if (h>0) return h + 'h ' + m + 'm';
        if (m>0) return m + 'm ' + ss + 's';
        return ss + 's';
    }

    // Wire up the Start Routing modal's handlers once its DOM exists. There's
    // no floating map button for this anymore — routing opens via the Route
    // nav pill (topbar/mobile tab bar, see index.html) or the telemetry
    // card's "Get there before it lands" CTA, matching the design mockup.
    function ensureRoutingUi(){
        try {
            if (!document.getElementById('chaseRoutingModal')) { return false; }
            ensureDialog();
            return true;
        } catch (err) {
            console.error('[chase_routing] ensureRoutingUi error', err);
            return false;
        }
    }

    // Wait for the modal to exist, then wire it up. Poll for a short time.
    var tries = 0;
    var t = setInterval(function(){
        if (ensureRoutingUi()){ clearInterval(t); }
        if (++tries > 40){ clearInterval(t); }
    }, 250);

})();
