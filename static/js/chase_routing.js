// Chase routing UI and control
// Adds a small dialog to select a callsign to chase, a start location (GPS, manual, or chase car)
// and uses Leaflet Routing Machine to show car directions to the predicted landing.

// Globals used by predictions.js as well
window.router = null;
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
                if (predMarker) {
                    var predLatlng = predMarker.getLatLng();
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
            // Replace or create displayed polyline
            if (window._displayChasePolyline) {
                window._displayChasePolyline.setLatLngs(newPts);
            } else {
                if (window.map) window._displayChasePolyline = L.polyline(newPts, {color:'#3b82f6', weight:4, opacity:0.9}).addTo(window.map);
            }
            // Also update Cesium view if available
            try { if (typeof window.showChaseRouteOnCesium === 'function') window.showChaseRouteOnCesium(newPts); } catch(e){}
            // update stored route as GeoJSON too
            try { window.latestChaseRouteGeoJSON = { type:'Feature', geometry:{ type:'LineString', coordinates: newPts.map(function(a){ return [a[1], a[0]]; }) }, properties: { updatedBy: 'advance' } }; pushLatestRouteToServer(window.latestChaseRouteGeoJSON); } catch(e){}
            // The route itself didn't change, just how far along it the car
            // is - refresh the panel's passed/next-turn state either way.
            if (typeof window.renderRoutePanel === 'function') { window.renderRoutePanel(); }
        } catch (e) { console.warn('advanceDisplayedRouteAlongIndex error', e); }
    }

    // The chase-status readout (Chasing/ETA/Distance) lives inside the Leaflet
    // Routing Machine itinerary panel (.leaflet-routing-container) rather than
    // as its own floating box, so it travels with the directions instead of
    // overlapping them. Leaflet Routing Machine only re-renders its inner
    // .leaflet-routing-alternatives-container on route updates, so a bar
    // prepended to the outer container survives those re-renders.
    function ensureChaseStatusBar(){
        if ($('#chase-status').length) return;
        var container = document.querySelector('.leaflet-routing-container');
        if (!container) return;
        var $bar = $(
            "<div id='chase-status' class='chase-status-inline' style='display:none;' title='Drag to move the directions panel'>" +
                "<span class='chase-status-item'><strong>Chasing:</strong> <span id='chaseStatusCall'>None</span></span>" +
                "<span class='chase-status-item'><strong>ETA:</strong> <span id='chaseStatusETA'>--</span></span>" +
                "<span class='chase-status-item'><strong>Distance:</strong> <span id='chaseStatusDist'>--</span></span>" +
            "</div>"
        );
        $(container).prepend($bar);
        // Drag the whole directions panel by its chase-status bar.
        try {
            $(container).draggable({ handle: '#chase-status', containment: 'window' });
        } catch (e) {
            // jQuery UI may not be available; ignore.
        }
    }

    function updateChaseRoutingSubtitle(){
        var cs = $('#chaseCalls').val();
        $('#chaseRoutingSubtitle').text(cs ? ('to ' + cs + ' (live balloon position)') : 'Select a callsign to chase');
    }
    window.updateChaseRoutingSubtitle = updateChaseRoutingSubtitle;

    function openChaseRoutingModal(){
        var $modal = $('#chaseRoutingModal');
        var $card = $modal.find('.chase-routing-modal-card');
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
            if (!window.router && typeof L !== 'undefined' && map){
                window.router = L.Routing.control({waypoints:[], addWaypoints:false, routeWhileDragging:false, showAlternatives:true, position:'topleft'}).addTo(map);
                attachRouterEvents(window.router);
                ensureChaseStatusBar();
            }

            closeChaseRoutingModal();
            if (typeof window.openRoutePanel === 'function') window.openRoutePanel();

            var pred_marker = (balloon_positions[cs] && balloon_positions[cs].pred_marker) ? balloon_positions[cs].pred_marker.getLatLng() : null;
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
            if (window.router){ window.router.getPlan().setWaypoints([]); }
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
        sel.empty();
        for (var cs in balloon_positions){
            if (!balloon_positions.hasOwnProperty(cs)) continue;
            sel.append($('<option>').attr('value', cs).text(cs));
        }
    }

    function setRouteToPrediction(callsign, predLatLng){
        if (!predLatLng){
            // no prediction yet; leave waypoints cleared until prediction arrives
            return;
        }
        if (!window.router && typeof L !== 'undefined' && map){
            window.router = L.Routing.control({waypoints:[], addWaypoints:false, routeWhileDragging:false, showAlternatives:true, position:'topleft'}).addTo(map);
            attachRouterEvents(window.router);
            ensureChaseStatusBar();
        }
        if (!window.router) return;

        var startLat, startLon;
        if (window.start_mode === 'chasecar' && chase_car_position && Array.isArray(chase_car_position.latest_data) && chase_car_position.latest_data.length >= 2){
            startLat = chase_car_position.latest_data[0]; startLon = chase_car_position.latest_data[1];
        } else if (window.start_mode === 'chasecar' && chase_car_position && chase_car_position.marker && typeof chase_car_position.marker.getLatLng === 'function'){
            var ll = chase_car_position.marker.getLatLng(); startLat = ll.lat; startLon = ll.lng;
        } else if (window.start_mode === 'manual' && window.manual_start){
            startLat = window.manual_start[0]; startLon = window.manual_start[1];
        } else if (window.start_mode === 'gps' && window.gps_start){
            startLat = window.gps_start[0]; startLon = window.gps_start[1];
        } else {
            startLat = chase_config.default_lat; startLon = chase_config.default_lon;
        }

        // record last attempted legs for potential fallback
        window._last_route_attempt = {startLat: startLat, startLon: startLon, endLat: predLatLng.lat, endLon: predLatLng.lng};
        try{
            window.router.setWaypoints([L.latLng(startLat, startLon), L.latLng(predLatLng.lat, predLatLng.lng)]);
            // Initialize position tracking for car movement detection
            window.last_route_calc_position = [startLat, startLon];
            // clear last fallback attempt flag
            window._chase_tried_fallback = false;
        }catch(e){
            console.error('Routing setWaypoints failed', e);
            // Try HTTP OSRM fallback
            try { fetchOsrmRoute(startLat, startLon, predLatLng.lat, predLatLng.lng); } catch(errfb) { console.warn('Fallback route failed', errfb); }
        }
        // Update status panel to show active chased callsign
        $('#chase-status').show();
        $('#chaseStatusCall').text(callsign);
    }

    function applyFetchedRoute(route, sourceLabel){
        // This fallback path only runs when LRM itself failed, and the
        // backend/OSRM response shape here doesn't carry turn-by-turn
        // instructions (unlike LRM's routesfound routes) - the Route panel
        // degrades gracefully (footer stats only, no turn list) when
        // .instructions is absent.
        window.currentSelectedRoute = route;
        var coords = route.geometry.coordinates; // [lon,lat]
        var latlngs = coords.map(function(c){ return [c[1], c[0]]; });
        // Draw or replace displayed polyline (used by advance logic)
        try {
            if (window._displayChasePolyline) { window.map.removeLayer(window._displayChasePolyline); }
            window._displayChasePolyline = L.polyline(latlngs, {color:'#3b82f6', weight:4, opacity:0.9}).addTo(window.map);
            // populate currentChaseRouteLatLngs for in-place advancement
            window.currentChaseRouteLatLngs = latlngs.map(function(ll){ return {lat: ll[0], lng: ll[1]}; });
            window.last_route_destination = [latlngs[latlngs.length-1][0], latlngs[latlngs.length-1][1]];
        } catch (e) { console.warn('Failed to draw fallback polyline', e); }

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
        window._chase_tried_fallback = true;
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

    function fetchOsrmRoute(startLat, startLon, endLat, endLon){
        if (!window.map) return;
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
                duration: j.duration_s || 0
            };
            applyFetchedRoute(route, 'osrm-backend');
        }).catch(function(backendErr){
            if (_seq !== _routeFetchSeq) return;
            console.warn('Backend routing failed, trying direct OSRM', backendErr);
            var base = window.osrm_base || 'https://router.project-osrm.org/route/v1/driving/';
            var url = base + startLon + ',' + startLat + ';' + endLon + ',' + endLat + '?overview=full&geometries=geojson&annotations=distance,duration&alternatives=true';
            fetch(url).then(function(resp){ return resp.json(); }).then(function(j){
                if (_seq !== _routeFetchSeq) return;
                if (!j || !j.routes || j.routes.length === 0) { throw new Error('No routes'); }
                window.currentRouteAlternatives = j.routes;
                applyFetchedRoute(selectPreferredRoute(j.routes), 'osrm-fallback');
            }).catch(function(err){
                if (_seq !== _routeFetchSeq) return;
                console.warn('OSRM fallback failed', err);
                // if fallback fails, notify user; routingerror handler will also restore UI
                try { $('#gpsStatus').text('Routing failed'); if (typeof window.showAppToast === 'function') window.showAppToast('Routing failed'); } catch(e){}
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
                setRouteToPrediction(callsign, L.latLng(predLanding[0], predLanding[1]));
            }
        }
    };

    // Attach routing events to update ETA/Distance in chase-status panel
    function attachRouterEvents(r){
        if (!r) return;
        if (r._chase_events_attached) return; // avoid duplicate
        r._chase_events_attached = true;
        r.on('routesfound', function(e){
            try{
                if (e.routes && e.routes.length > 0){
                    var selected = selectPreferredRoute(e.routes) || e.routes[0];
                    // Stashed for the Route panel (renderRoutePanel) - the full
                    // alternatives list (for the Fastest/Shortest pills) and
                    // the one currently selected by window.route_preference.
                    window.currentRouteAlternatives = e.routes;
                    window.currentSelectedRoute = selected;

                    var s = selected.summary || selected.properties || {};
                    // LRM summary fields may be totalDistance/totalTime or distance/time depending on router
                    var dist = s.totalDistance || s.total_distance || s.total_distance_in_meters || s.distance || 0;
                    var time = s.totalTime || s.total_time || s.total_time_in_seconds || s.time || 0;
                    var distText = (dist >= 1000) ? ((dist/1000).toFixed(1) + ' km') : (Math.round(dist) + ' m');
                    var etaText = formatTimeSeconds(time);
                    $('#chaseStatusDist').text(distText);
                    $('#chaseStatusETA').text(etaText);
                    if (typeof window.renderRoutePanel === 'function') { window.renderRoutePanel(); }
                    if (typeof window.renderRoutingActivePill === 'function') { window.renderRoutingActivePill(); }
                    // Also mirror the calculated route to the 3D Cesium view if available.
                    try {
                        var coords = null;
                        if (selected.coordinates && Array.isArray(selected.coordinates)) {
                            coords = selected.coordinates; // array of [lat,lon] or [lon,lat]
                        } else if (selected.geometry && selected.geometry.coordinates) {
                            coords = selected.geometry.coordinates; // GeoJSON [lon,lat]
                        } else if (selected.waypoints && Array.isArray(selected.waypoints)) {
                            coords = selected.waypoints.map(function(wp){ return [wp.lat || wp.latLng && wp.latLng.lat || wp.lat, wp.lon || wp.lng || wp.latLng && wp.latLng.lng || wp.lon]; });
                        }

                        if (coords && typeof window.showChaseRouteOnCesium === 'function') {
                            // Normalize to array of {lat, lng}
                            var latlngs = coords.map(function(c) {
                                if (Array.isArray(c)) {
                                    // heuristic: if first value is longitude (abs>90), swap
                                    var a = parseFloat(c[0]); var b = parseFloat(c[1]);
                                    if (Math.abs(a) > 90 && Math.abs(b) <= 90) {
                                        return {lat: b, lng: a};
                                    }
                                    return {lat: a, lng: b};
                                } else if (c && c.lat !== undefined && c.lng !== undefined) {
                                    return {lat: c.lat, lng: c.lng};
                                } else if (c && c.latitude !== undefined && c.longitude !== undefined) {
                                    return {lat: c.latitude, lng: c.longitude};
                                }
                                return null;
                            }).filter(function(x){ return x !== null; });

                            if (latlngs.length > 0) {
                                // Create a normalized lat/lng array for Leaflet display and mobile export
                                var normLatLngs = latlngs.map(function(ll){ return [ll.lat, ll.lng]; });
                                try {
                                    window.currentChaseRouteLatLngs = normLatLngs.map(function(a){ return {lat: a[0], lng: a[1]}; });
                                    window.last_route_destination = [normLatLngs[normLatLngs.length-1][0], normLatLngs[normLatLngs.length-1][1]];
                                    if (window._displayChasePolyline) { try{ window.map.removeLayer(window._displayChasePolyline); } catch(e){} window._displayChasePolyline = null; }
                                    if (window._fallbackChasePolyline) { try{ window.map.removeLayer(window._fallbackChasePolyline); } catch(e){} window._fallbackChasePolyline = null; }
                                    window._displayChasePolyline = L.polyline(normLatLngs, {color:'#3b82f6', weight:4, opacity:0.9}).addTo(window.map);
                                } catch(e) { console.warn('Failed to create display polyline', e); }

                                window.showChaseRouteOnCesium(latlngs);
                                // Store last route as GeoJSON for mobile map compatibility (Apple/Google)
                                try {
                                    window.latestChaseRouteGeoJSON = {
                                        type: 'Feature',
                                        geometry: {
                                            type: 'LineString',
                                            coordinates: normLatLngs.map(function(ll){ return [ll[1], ll[0]]; })
                                        },
                                        properties: {}
                                    };
                                    pushLatestRouteToServer(window.latestChaseRouteGeoJSON);
                                } catch(e) { console.warn('Failed to set latestChaseRouteGeoJSON', e); }
                            }
                        }
                    } catch(errRouteCesium) {
                        console.warn('Failed to mirror route to Cesium', errRouteCesium);
                    }
                }
            }catch(err){ console.error('attachRouterEvents error', err); }

            // UI handling: when a route is found, clear the pending timeout,
            // hide the spinner and re-enable the start button. Kept in this single
            // routesfound listener (previously a second, duplicate listener).
            try {
                if (window._chase_route_timer) { clearTimeout(window._chase_route_timer); window._chase_route_timer = null; }
                $('#chaseRoutingSpinner').hide();
                $('#startChaseBtn').prop('disabled', false);
                if (typeof window.showAppToast === 'function') window.showAppToast('Route ready');
                // Keep the Chase Routing modal open so user can review or re-run routing
                // Do not auto-close the modal; user may manually close it when ready.
            } catch (uiErr) { console.warn('chase routing UI update error', uiErr); }
        });

        // Handle routing errors to restore UI
        r.on('routingerror', function(err){
            try {
                console.warn('Routing error', err);
                $('#chaseRoutingSpinner').hide();
                $('#startChaseBtn').prop('disabled', false);
                if (typeof window.showAppToast === 'function') window.showAppToast('Routing failed');
                $('#gpsStatus').text('Routing failed');
                // Attempt HTTP OSRM fallback once if we have coordinates
                if (!window._chase_tried_fallback && window._last_route_attempt) {
                    try {
                        fetchOsrmRoute(window._last_route_attempt.startLat, window._last_route_attempt.startLon, window._last_route_attempt.endLat, window._last_route_attempt.endLon);
                    } catch(e) { console.warn('Fallback attempt error', e); }
                }
            } catch (er) { console.warn('Error handling routingerror UI', er); }
        });
    }

    // ---------------------------------------------------------------------
    // Route panel (full turn-by-turn) + routing-active stop pill.
    // Reads window.currentSelectedRoute / window.currentRouteAlternatives,
    // populated by the routesfound handler / applyFetchedRoute above.
    // ---------------------------------------------------------------------

    var ROUTE_ARROW_ICON = '<line x1="12" y1="19" x2="12" y2="6"></line><path d="M7 11 L12 6 L17 11"></path>';
    var ROUTE_ARRIVE_ICON = '<path d="M6 3v18"></path><path d="M6 4h11l-3 4 3 4H6"></path>';

    function classifyInstruction(instr){
        var t = (instr && instr.type) || '';
        var m = (instr && instr.modifier) || '';
        if (t === 'DestinationReached' || t === 'WaypointReached') return 'arrive';
        if (/Left/i.test(t) || /left/i.test(m)) return 'left';
        if (/Right/i.test(t) || /right/i.test(m)) return 'right';
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

    // LRM's own Formatter turns an OSRM instruction into the human string
    // ("Continue on County Rd 12", "Turn left onto Territorial Rd") - reused
    // here instead of hand-building instruction text.
    var _routeFormatter = null;
    function formatRouteInstruction(instr, i){
        try {
            if (!_routeFormatter && typeof L !== 'undefined' && L.Routing && L.Routing.formatter){
                _routeFormatter = L.Routing.formatter();
            }
            if (_routeFormatter){
                var text = _routeFormatter.formatInstruction(instr, i);
                if (text) return text;
            }
        } catch(e){ /* fall through to manual text below */ }
        if (instr.text) return instr.text;
        var road = instr.road ? (' onto ' + instr.road) : '';
        return (instr.type || 'Continue') + road;
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
    }
    window.renderRoutingActivePill = renderRoutingActivePill;

    $(document).on('click', '#routingActivePillStopBtn', function(e){
        e.stopPropagation();
        $('#stopChaseBtn').trigger('click');
    });
    $(document).on('click', '#routingActivePill', function(e){
        if ($(e.target).closest('#routingActivePillStopBtn').length) return;
        openRoutePanel();
    });

    function openRoutePanel(){
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

        var cs = window.balloon_currently_chased;
        if (!cs || cs === 'none'){
            $panel.empty();
            return;
        }

        $panel.toggleClass('is-collapsed', route_panel_collapsed);

        var route = window.currentSelectedRoute;
        var alternatives = window.currentRouteAlternatives || (route ? [route] : []);

        var headerHtml =
            '<div class="route-panel-header">' +
                '<span class="route-panel-title">Route</span>' +
                '<button type="button" class="route-panel-collapse-btn" aria-label="' + (route_panel_collapsed ? 'Expand' : 'Collapse') + '">' +
                    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(' + (route_panel_collapsed ? '180' : '0') + 'deg)"><path d="M6 9l6 6 6-6"></path></svg>' +
                '</button>' +
            '</div>';

        // Best-effort ALT/descent readout for the routed callsign: reuses the
        // telemetry card's already-current text rather than re-deriving it from
        // scratch, since the routed payload is normally also the followed one.
        var targetAlt = $('#telemReadoutAlt').text();
        var targetDesc = $('#telemReadoutDescent').text();
        var targetRowHtml = '<div class="route-target-row">' +
            '<span class="route-target-callsign mono">' + escapeHtml(cs) + '</span>' +
            '<span class="route-target-meta mono">' + escapeHtml(targetAlt || '') +
                (targetAlt && targetDesc ? ' &middot; ' : '') + escapeHtml(targetDesc || '') + '</span>' +
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
            $panel.html(headerHtml + targetRowHtml + altPillsHtml + '<div class="route-panel-waiting">Calculating route&hellip;</div>');
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
        var $floatingFooter = $('#routePanelFooter');
        if (route_panel_collapsed){
            $floatingFooter.html('<div class="route-panel-footer">' + footerInnerHtml + '</div>').show();
            $panel.html(headerHtml + targetRowHtml + altPillsHtml + heroHtml);
        } else {
            $floatingFooter.hide().empty();
            $panel.html(headerHtml + targetRowHtml + altPillsHtml + heroHtml + passedRowHtml + listHtml + '<div class="route-panel-footer">' + footerInnerHtml + '</div>');
        }
    }
    window.renderRoutePanel = renderRoutePanel;

    $(document).on('click', '#routeCtaBtn', function(){
        // Re-center the map on the chase car, same helper the other side
        // panels use to keep their content clear of the map focus point.
        if (window.last_route_calc_position && typeof window.panMapToVisibleCenter === 'function'){
            window.panMapToVisibleCenter(L.latLng(window.last_route_calc_position[0], window.last_route_calc_position[1]));
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

    // Add easy button on map once available
    function addMapButton(){
        try {
            if (typeof L === 'undefined') { return false; }
            if (typeof map === 'undefined') { return false; }

            // Ensure dialog created
            ensureDialog();

            // Use the same icon shorthand used elsewhere (e.g. 'fa-car')
            var btn = L.easyButton('fa-location-arrow', function(btnLocal, mapLocal){
                populateCalls();
                if (typeof window.openChaseRoutingModal === 'function') {
                    window.openChaseRoutingModal();
                } else {
                    // fallback to previous jQuery UI dialog if present
                    $('#chase-routing-dialog').dialog && $('#chase-routing-dialog').dialog('open');
                }
            }, 'Chase Routing', 'chaseRoutingButton', { position: 'topright' });
            btn.addTo(map);
            return true;
        } catch (err) {
            console.error('[chase_routing] addMapButton error', err);
            return false;
        }
    }

    // Wait for map to exist, then add button. Poll for a short time.
    var tries = 0;
    var t = setInterval(function(){
        if (addMapButton()){ clearInterval(t); }
        if (++tries > 40){ clearInterval(t); }
    }, 250);

})();
