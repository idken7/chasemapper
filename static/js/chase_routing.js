// Chase routing UI and control
// Adds a small dialog to select a callsign to chase, a start location (GPS, manual, or chase car)
// and uses Leaflet Routing Machine to show car directions to the predicted landing.

// Globals used by predictions.js as well
window.router = null;
window.balloon_currently_chased = "none"; // only one callsign can be chased at a time
window.start_mode = 'chasecar'; // 'gps' | 'manual' | 'chasecar'
window.manual_start = null; // [lat, lon]
window.gps_start = null; // [lat, lon]

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
        } catch (e) { console.warn('advanceDisplayedRouteAlongIndex error', e); }
    }

    // Ensure chase-status panel exists (fallback if template missing)
    if (typeof $ !== 'undefined' && $('#chase-status').length == 0){
        $('body').append("<div id='chase-status' style='position: absolute; top: 10px; right: 10px; background: rgba(255,255,255,0.92); padding:8px; border-radius:4px; z-index:1000; display:none; box-shadow:0 1px 4px rgba(0,0,0,0.3); font-size:13px;'><div><strong>Chasing:</strong> <span id='chaseStatusCall'>None</span></div><div><strong>ETA:</strong> <span id='chaseStatusETA'>--</span></div><div><strong>Distance:</strong> <span id='chaseStatusDist'>--</span></div></div>");
    }

    function openChaseRoutingModal(){
        var $modal = $('#chaseRoutingModal');
        var $card = $modal.find('.chase-routing-modal-card');
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

        $('#startMode').on('change', function(){
            var v = $(this).val();
            window.start_mode = v;
            if (v === 'manual') $('#manualStartDiv').show(); else $('#manualStartDiv').hide();
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

        $('#getGPSBtn').on('click', function(){
            if (!navigator.geolocation){
                $('#gpsStatus').text('Geolocation not supported');
                return;
            }
            $('#gpsStatus').text('Getting...');
            navigator.geolocation.getCurrentPosition(function(pos){
                window.gps_start = [pos.coords.latitude, pos.coords.longitude];
                window.start_mode = 'gps';
                $('#startMode').val('gps');
                $('#gpsStatus').text('GPS obtained.');
            }, function(err){
                $('#gpsStatus').text('GPS error: ' + err.message);
            }, {enableHighAccuracy:true, timeout:10000});
        });

        $('#startChaseBtn').on('click', function(){
            var cs = $('#chaseCalls').val();
            if (!cs){ $('#gpsStatus').text('Select a callsign'); return; }
            window.balloon_currently_chased = cs;
            if (!window.router && typeof L !== 'undefined' && map){
                window.router = L.Routing.control({waypoints:[], addWaypoints:false, routeWhileDragging:false}).addTo(map);
                attachRouterEvents(window.router);
            }

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
            if (window.router){ window.router.getPlan().setWaypoints([]); }
            if (typeof window.clearChaseRouteOnCesium === 'function') {
                try { window.clearChaseRouteOnCesium(); } catch (e) {}
            }
            $('#chaseStatusCall').text('None');
            $('#chaseStatusETA').text('--');
            $('#chaseStatusDist').text('--');
            $('#chase-status').hide();
            closeChaseRoutingModal();
        });

        // Close modal on backdrop click
        $modal.find('.recovery-modal-backdrop').on('click', function(){ closeChaseRoutingModal(); });
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
            window.router = L.Routing.control({waypoints:[], addWaypoints:false, routeWhileDragging:false}).addTo(map);
            attachRouterEvents(window.router);
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
            console.debug('[chase_routing] setRouteToPrediction: setting waypoints', startLat, startLon, predLatLng.lat, predLatLng.lng);
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
    }

    // Route fetch helper: prefer backend /api/route, fallback to direct OSRM
    function fetchOsrmRoute(startLat, startLon, endLat, endLon){
        if (!window.map) return;
        fetch('/api/route', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ start_lat: startLat, start_lon: startLon, end_lat: endLat, end_lon: endLon })
        }).then(function(resp){
            if (!resp.ok) throw new Error('Backend route failed: ' + resp.status);
            return resp.json();
        }).then(function(j){
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
            console.warn('Backend routing failed, trying direct OSRM', backendErr);
            var base = window.osrm_base || 'https://router.project-osrm.org/route/v1/driving/';
            var url = base + startLon + ',' + startLat + ';' + endLon + ',' + endLat + '?overview=full&geometries=geojson&annotations=distance,duration';
            console.debug('[chase_routing] fetchOsrmRoute direct', url);
            fetch(url).then(function(resp){ return resp.json(); }).then(function(j){
                if (!j || !j.routes || j.routes.length === 0) { throw new Error('No routes'); }
                applyFetchedRoute(j.routes[0], 'osrm-fallback');
            }).catch(function(err){
                console.warn('OSRM fallback failed', err);
                // if fallback fails, notify user; routingerror handler will also restore UI
                try { $('#gpsStatus').text('Routing failed'); if (typeof window.showAppToast === 'function') window.showAppToast('Routing failed'); } catch(e){}
            });
        });
    }

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
                    var s = e.routes[0].summary || e.routes[0].properties || {};
                    // LRM summary fields may be totalDistance/totalTime or distance/time depending on router
                    var dist = s.totalDistance || s.total_distance || s.total_distance_in_meters || s.distance || 0;
                    var time = s.totalTime || s.total_time || s.total_time_in_seconds || s.time || 0;
                    var distText = (dist >= 1000) ? ((dist/1000).toFixed(1) + ' km') : (Math.round(dist) + ' m');
                    var etaText = formatTimeSeconds(time);
                    $('#chaseStatusDist').text(distText);
                    $('#chaseStatusETA').text(etaText);
                    // Also mirror the calculated route to the 3D Cesium view if available.
                    try {
                        var coords = null;
                        if (e.routes[0].coordinates && Array.isArray(e.routes[0].coordinates)) {
                            coords = e.routes[0].coordinates; // array of [lat,lon] or [lon,lat]
                        } else if (e.routes[0].geometry && e.routes[0].geometry.coordinates) {
                            coords = e.routes[0].geometry.coordinates; // GeoJSON [lon,lat]
                        } else if (e.routes[0].waypoints && Array.isArray(e.routes[0].waypoints)) {
                            coords = e.routes[0].waypoints.map(function(wp){ return [wp.lat || wp.latLng && wp.latLng.lat || wp.lat, wp.lon || wp.lng || wp.latLng && wp.latLng.lng || wp.lon]; });
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
        });

        // Additional UI handling: when any route is found, hide spinner and close modal if open
        r.on('routesfound', function(e){
            try {
                // Clear any pending timeout for route calculation
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
            if (typeof L === 'undefined') { console.debug('[chase_routing] L (Leaflet) undefined'); return false; }
            if (typeof map === 'undefined') { console.debug('[chase_routing] map undefined'); return false; }

            // Ensure dialog created
            ensureDialog();

            // Use the same icon shorthand used elsewhere (e.g. 'fa-car')
            var btn = L.easyButton('fa-location-arrow', function(btnLocal, mapLocal){
                console.debug('[chase_routing] Chase Routing button clicked');
                populateCalls();
                if (typeof window.openChaseRoutingModal === 'function') {
                    window.openChaseRoutingModal();
                } else {
                    // fallback to previous jQuery UI dialog if present
                    $('#chase-routing-dialog').dialog && $('#chase-routing-dialog').dialog('open');
                }
            }, 'Chase Routing', 'chaseRoutingButton', { position: 'topright' });
            btn.addTo(map);
            console.debug('[chase_routing] Chase Routing button added to map');
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
