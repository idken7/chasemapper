// Chase routing UI and control
// Adds a small dialog to select a callsign to chase, a start location (GPS, manual, or chase car)
// and uses Leaflet Routing Machine to show car directions to the predicted landing.

// Globals used by predictions.js as well
window.router = null;
window.balloon_currently_chased = "none"; // only one callsign can be chased at a time
window.start_mode = 'chasecar'; // 'gps' | 'manual' | 'chasecar'
window.manual_start = null; // [lat, lon]
window.gps_start = null; // [lat, lon]

(function(){
    // Ensure chase-status panel exists (fallback if template missing)
    if (typeof $ !== 'undefined' && $('#chase-status').length == 0){
        $('body').append("<div id='chase-status' style='position: absolute; top: 10px; right: 10px; background: rgba(255,255,255,0.92); padding:8px; border-radius:4px; z-index:1000; display:none; box-shadow:0 1px 4px rgba(0,0,0,0.3); font-size:13px;'><div><strong>Chasing:</strong> <span id='chaseStatusCall'>None</span></div><div><strong>ETA:</strong> <span id='chaseStatusETA'>--</span></div><div><strong>Distance:</strong> <span id='chaseStatusDist'>--</span></div></div>");
    }

    function ensureDialog(){
        if ($('#chase-routing-dialog').length) return;

        var html = "<div style='padding:8px;'>" +
            "<label>Calls Sign: </label> <select id='chaseCalls'></select><br/><br/>" +
            "<label>Start From: </label> <select id='startMode'><option value='chasecar'>Chase Car</option><option value='gps'>My GPS</option><option value='manual'>Manual Lat,Lon</option></select><br/><br/>" +
            "<div id='manualStartDiv' style='display:none'>Lat: <input id='manualLat' size='10'/> Lon: <input id='manualLon' size='10'/> <button id='setManualStart'>Set</button></div>" +
            "<div style='margin-top:8px;'><button id='getGPSBtn'>Get GPS</button> <span id='gpsStatus'></span></div>" +
            "<div style='margin-top:12px;'><button id='startChaseBtn'>Start Routing</button> <button id='stopChaseBtn'>Stop</button></div>" +
            "</div>";

        $('body').append("<div id='chase-routing-dialog' title='Chase Routing' style='display:none'>"+html+"</div>");

        $('#chase-routing-dialog').dialog({autoOpen:false, width:420});

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
            // Only one chased at a time
            window.balloon_currently_chased = cs;
            // Ensure router exists
            if (!window.router && typeof L !== 'undefined' && map){
                window.router = L.Routing.control({waypoints:[], addWaypoints:false, routeWhileDragging:false}).addTo(map);
                attachRouterEvents(window.router);
            }

            // Try to set initial waypoint to prediction if present
            var pred_marker = (balloon_positions[cs] && balloon_positions[cs].pred_marker) ? balloon_positions[cs].pred_marker.getLatLng() : null;
            if (pred_marker == null){
                $('#gpsStatus').text('No prediction yet; will update when available');
            }

            setRouteToPrediction(cs, pred_marker);
            $('#chase-routing-dialog').dialog('close');
        });

        $('#stopChaseBtn').on('click', function(){
            window.balloon_currently_chased = 'none';
            if (window.router){ window.router.getPlan().setWaypoints([]); }
            // Hide status panel
            $('#chaseStatusCall').text('None');
            $('#chaseStatusETA').text('--');
            $('#chaseStatusDist').text('--');
            $('#chase-status').hide();
            $('#chase-routing-dialog').dialog('close');
        });
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
        if (window.start_mode === 'chasecar' && chase_car_position && chase_car_position.latest_data.length==3){
            startLat = chase_car_position.latest_data[0]; startLon = chase_car_position.latest_data[1];
        } else if (window.start_mode === 'manual' && window.manual_start){
            startLat = window.manual_start[0]; startLon = window.manual_start[1];
        } else if (window.start_mode === 'gps' && window.gps_start){
            startLat = window.gps_start[0]; startLon = window.gps_start[1];
        } else {
            startLat = chase_config.default_lat; startLon = chase_config.default_lon;
        }

        try{
            window.router.setWaypoints([L.latLng(startLat, startLon), L.latLng(predLatLng.lat, predLatLng.lng)]);
        }catch(e){ console.error('Routing setWaypoints failed', e); }
        // Update status panel to show active chased callsign
        $('#chase-status').show();
        $('#chaseStatusCall').text(callsign);
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
                }
            }catch(err){ console.error('attachRouterEvents error', err); }
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
        if (typeof L === 'undefined' || typeof map === 'undefined') return false;

        // Ensure dialog created
        ensureDialog();

        var btn = L.easyButton('<i class="fa fa-location-arrow"></i>', function(btnLocal, mapLocal){
            populateCalls();
            $('#chase-routing-dialog').dialog('open');
        }, 'Chase Routing');
        btn.addTo(map);
        return true;
    }

    // Wait for map to exist, then add button. Poll for a short time.
    var tries = 0;
    var t = setInterval(function(){
        if (addMapButton()){ clearInterval(t); }
        if (++tries > 40){ clearInterval(t); }
    }, 250);

})();
