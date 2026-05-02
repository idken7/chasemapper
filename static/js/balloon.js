//
//   Project Horus - Browser-Based Chase Mapper - Balloon Telemetry Handlers
//
//   Copyright (C) 2019  Mark Jessop <vk5qi@rfhead.net>
//   Released under GNU GPL v3 or later
//

function normalizeTelemetryForMap(data) {
    if (!data) {
        return null;
    }

    var normalized = Object.assign({}, data);
    normalized.callsign = (normalized.callsign || '').toString().toUpperCase();
    if (!normalized.callsign) {
        return null;
    }

    if (!Array.isArray(normalized.position)) {
        var lat = normalized.lat;
        var lon = normalized.lon;
        if (lon === undefined) {
            lon = normalized.lng;
        }
        if (lat !== undefined && lon !== undefined) {
            normalized.position = [lat, lon, normalized.alt || 0];
        }
    }

    if (!Array.isArray(normalized.position) || normalized.position.length < 2) {
        return null;
    }

    var parsedPosition = [
        parseFloat(normalized.position[0]),
        parseFloat(normalized.position[1]),
        parseFloat(normalized.position.length > 2 ? normalized.position[2] : 0)
    ];

    if (!isFinite(parsedPosition[0]) || !isFinite(parsedPosition[1])) {
        return null;
    }

    if (!isFinite(parsedPosition[2])) {
        parsedPosition[2] = 0;
    }

    normalized.position = parsedPosition;
    normalized.vel_v = isFinite(parseFloat(normalized.vel_v)) ? parseFloat(normalized.vel_v) : 0;
    normalized.speed = isFinite(parseFloat(normalized.speed)) ? parseFloat(normalized.speed) : 0;
    normalized.max_alt = isFinite(parseFloat(normalized.max_alt)) ? parseFloat(normalized.max_alt) : normalized.position[2];
    normalized.time_to_landing = normalized.time_to_landing || '';
    return normalized;
}

function validMapPoint(point) {
    if (!Array.isArray(point) || point.length < 2) {
        return false;
    }
    return isFinite(parseFloat(point[0])) && isFinite(parseFloat(point[1]));
}

function normalizeMapPoint(point) {
    var lat = parseFloat(point[0]);
    var lon = parseFloat(point[1]);
    var alt = parseFloat(point.length > 2 ? point[2] : 0);
    return [lat, lon, isFinite(alt) ? alt : 0];
}

function normalizeMapPointList(points) {
    if (!Array.isArray(points)) {
        return [];
    }

    return points.filter(validMapPoint).map(normalizeMapPoint);
}

function buildTelemetrySnapshotFromLiveData(data) {
    data = normalizeTelemetryForMap(data);
    if (!data) {
        return null;
    }

    return {
        telem: data,
        path: [data.position],
        burst: [],
        pred_path: [],
        pred_landing: [],
        abort_path: [],
        abort_landing: []
    };
}

function updateBalloonMarkerIcon(callsign, telem) {
    if (!balloon_positions.hasOwnProperty(callsign) || !balloon_positions[callsign].marker) {
        return;
    }

    if (!telem || !telem.position || !balloon_positions[callsign].colour) {
        console.warn('updateBalloonMarkerIcon: invalid telem or colour for', callsign);
        return;
    }

    try {
        var colour = balloon_positions[callsign].colour;
        var alt = parseFloat(telem.position[2]) || 0;
        var newIcon = null;

        // Determine which icon to use based on state
        if (alt < parachute_min_alt) {
            // Payload has descended below parachute altitude
            if (_is3DEnabled()) {
                newIcon = createBalloonIcon(telem, colour);
            } else {
                newIcon = balloonPayloadIcons[colour];
            }
        } else if (telem.vel_v < 0) {
            // Balloon is descending
            if (_is3DEnabled()) {
                newIcon = createBalloonIcon(telem, colour);
            } else {
                newIcon = balloonDescentIcons[colour];
            }
        } else {
            // Balloon is ascending
            if (_is3DEnabled()) {
                newIcon = createBalloonIcon(telem, colour);
            } else {
                newIcon = balloonAscentIcons[colour];
            }
        }

        // Verify icon exists before setting
        if (newIcon) {
            balloon_positions[callsign].marker.setIcon(newIcon);
        } else {
            console.warn('updateBalloonMarkerIcon: newIcon is null for', callsign, 'colour=', colour, '3D=', _is3DEnabled());
        }
    } catch (e) {
        console.error('updateBalloonMarkerIcon: error updating icon for', callsign, e);
    }
}

function _is3DEnabled(){
    try{
        if (typeof chase_config !== 'undefined' && chase_config.enable_3d_markers === true) return true;
        var v = localStorage.getItem('enable_3d_markers');
        return v === '1' || v === 'true';
    }catch(e){
        return false;
    }
}

function createBalloonIcon(telem, colour){
    if (!_is3DEnabled()){
        // fall back to existing icons (ascent/descent handling done elsewhere)
        return null;
    }
    var alt = parseFloat(telem.position[2]) || 0;
    // visual scale: 1 px per 2 meters, clamp
    var h = Math.min(Math.max(8, Math.round(alt / 2)), 260);
    var html = '<div class="extrusion-outer" style="height:'+h+'px;">'
             + '<div class="alt-extrusion" style="height:'+h+'px;background:'+colour+';opacity:0.25;border-radius:4px;margin:0 auto;width:6px"></div>'
             + '</div>'
             + '<div class="extruded-dot" style="background:'+colour+';width:16px;height:16px;border-radius:50%;margin-top:6px;border:2px solid rgba(255,255,255,0.9)"></div>';
    return L.divIcon({className:'extruded-marker', html:html, iconSize:[18, h+30], iconAnchor:[9, h+18]});
}

// Refresh icons for all existing balloon markers (re-apply 3D or 2D icons)
function refreshAllBalloonIcons(){
    try{
        for (var callsign in balloon_positions){
            if (!Object.prototype.hasOwnProperty.call(balloon_positions, callsign)) continue;
            var bp = balloon_positions[callsign];
            if (!bp || !bp.latest_data) continue;
            try{
                updateBalloonMarkerIcon(callsign, bp.latest_data);
            }catch(e){
                console.warn('refreshAllBalloonIcons: failed for', callsign, e);
            }
        }
    }catch(e){
        console.warn('refreshAllBalloonIcons error', e);
    }
}


function add_new_balloon(data){
    // Add a new balloon to the telemetry store.
    // This function accepts a dictionary which conttains:
    //  telem: Latest telemetry dictionary, containing:
    //      callsign:
    //      position: [lat, lon, alt]
    //      vel_v
    //  path: Flight path so far.
    //  pred_path: Predicted flight path (can be empty)
    //  pred_landing: [lat, lon, alt] coordinate for predicted landing.
    //  abort_path: Abort prediction path
    //  abort_landing: Abort prediction landing location

    if (!data || !data.telem) {
        return false;
    }

    var telem = normalizeTelemetryForMap(data.telem);
    if (!telem) {
        return false;
    }
    data.telem = telem;

    var callsign = telem.callsign;

    // Enforce APRS allowlist for any direct-add flows (archive replay / prefilled lists)
    try{
        if (callsign !== 'CAR' && typeof chase_config !== 'undefined' && Array.isArray(chase_config.aprs_callsigns) && chase_config.aprs_callsigns.length > 0){
            var csKey = (callsign || '').toString().toUpperCase();
            var allowed = chase_config.aprs_callsigns.some(function(x){ return (x||'').toString().toUpperCase() === csKey; });
            if (!allowed){
                console.debug('add_new_balloon: rejecting non-APRS callsign', csKey);
                return false;
            }
        }
    }catch(e){ /* proceed if something goes wrong with config */ }

    var pathData = normalizeMapPointList(data.path);
    if (pathData.length === 0) {
        pathData = [telem.position];
    }
    if (pathData.length === 1) {
        pathData = [pathData[0], pathData[0]];
    }
    var predPathData = normalizeMapPointList(data.pred_path);
    var predLandingData = validMapPoint(data.pred_landing) ? normalizeMapPoint(data.pred_landing) : [];
    var burstData = validMapPoint(data.burst) ? normalizeMapPoint(data.burst) : [];
    var abortPathData = normalizeMapPointList(data.abort_path);
    var abortLandingData = validMapPoint(data.abort_landing) ? normalizeMapPoint(data.abort_landing) : [];

    balloon_positions[callsign] = {
        latest_data: telem,
        age: 0,
        colour: colour_values[colour_idx],
        snr: -255.0,
        visible: true
    };
    // Balloon Path
    balloon_positions[callsign].path = L.polyline(pathData,{title:callsign + " Path", color:balloon_positions[callsign].colour}).addTo(map);
    // Balloon position marker - always start with 2D icon, then updateBalloonMarkerIcon will handle 3D if enabled
    var baseIcon = balloonAscentIcons[balloon_positions[callsign].colour];
    if (!baseIcon) {
        console.error('add_new_balloon: baseIcon not found for colour', balloon_positions[callsign].colour, '- available colours:', Object.keys(balloonAscentIcons));
        return false;
    }
    balloon_positions[callsign].marker = L.marker(telem.position,{title:callsign, icon: baseIcon})
        .bindTooltip(callsign,{permanent:false,direction:'right'})
        .addTo(map);
    // Update icon to reflect 3D status or descent/payload state
    updateBalloonMarkerIcon(callsign, telem);


    // If the balloon is in descent, or is above the burst altitude, clear out the abort path and marker
    // so they don't get shown.
    if (telem.position[2] > chase_config.pred_burst || telem.vel_v < 0.0){
        balloon_positions[callsign].abort_path = [];
        balloon_positions[callsign].abort_landing = [];
    }

    // Add predicted landing path
    balloon_positions[callsign].pred_path = L.polyline(predPathData,{title:callsign + " Prediction", color:balloon_positions[callsign].colour, opacity:prediction_opacity}).addTo(map);

    // Landing position marker
    // Only add if there is data to show
    if (predLandingData.length == 3){
        var _landing_text = callsign + " Landing " + predLandingData[0].toFixed(5) + ", " + predLandingData[1].toFixed(5);
        balloon_positions[callsign].pred_marker = L.marker(predLandingData,{title:callsign + " Landing", icon: balloonLandingIcons[balloon_positions[callsign].colour]})
            .bindTooltip(_landing_text,{permanent:false,direction:'right'})
            .addTo(map);
        // Add listener to copy prediction coords to clipboard.
        // This is also duplicated in prediction.js, until I rearrange things...
        balloon_positions[callsign].pred_marker.on('click', function(e) {
            var _landing_pos_text = e.latlng.lat.toFixed(5) + ", " + e.latlng.lng.toFixed(5);
            textToClipboard(_landing_pos_text);
        });
    } else{
        balloon_positions[callsign].pred_marker = null;
    }

    // Burst position marker
    // Only add if there is data to show
    if (burstData.length == 3){
        balloon_positions[callsign].burst_marker = L.marker(burstData,{title:callsign + " Burst", icon: burstIcon})
            .bindTooltip(callsign + " Burst",{permanent:false,direction:'right'})
            .addTo(map);
    } else{
        balloon_positions[callsign].burst_marker = null;
    }

    // Abort path
    balloon_positions[callsign].abort_path = L.polyline(abortPathData,{title:callsign + " Abort Prediction", color:'red', opacity:prediction_opacity});

    if ((chase_config.show_abort == true) && (balloon_positions[callsign].visible == true)){
        balloon_positions[callsign].abort_path.addTo(map);
    }

    // Abort position marker
    if (abortLandingData.length == 3){
        balloon_positions[callsign].abort_marker = L.marker(abortLandingData,{title:callsign + " Abort", icon: abortIcon})
            .bindTooltip(callsign + " Abort Landing",{permanent:false,direction:'right'});
        if( (chase_config.show_abort == true) && (balloon_positions[callsign].visible == true)){
            balloon_positions[callsign].abort_marker.addTo(map);
        }
    }else{
        balloon_positions[callsign].abort_marker = null;
    }

    if (typeof flushPendingPrediction === 'function'){
        flushPendingPrediction(callsign);
    }

    
    colour_idx = (colour_idx+1)%colour_values.length; 

    return true;

}

function updateSummaryDisplay(){
    if ($("#summary_table").length === 0) {
        return;
    }
    
    if (chase_config['unitselection'] == "imperial") {updateSummaryDisplayImperial() ; return ; } // else do everything in metric
    // Update the 'Payload Summary' display.
    var _summary_update = {id:1};
    // See if there is any payload data.
    if (balloon_positions.hasOwnProperty(balloon_currently_following) == true){
        // There is balloon data!
        var _latest_telem = balloon_positions[balloon_currently_following].latest_data;
        
        _summary_update.alt = _latest_telem.position[2].toFixed(0) + "m (" + _latest_telem.max_alt.toFixed(0) + ")";
        var _speed = _latest_telem.speed*3.6;
        _summary_update.speed = _speed.toFixed(0) + " kph";
        _summary_update.vel_v = _latest_telem.vel_v.toFixed(1) + " m/s";


        // Work out if we have data to calculate look-angles from.
        if (chase_car_position.latest_data.length == 3){
            // Chase car position available - use that.
            var _car = {lat:chase_car_position.latest_data[0], lon:chase_car_position.latest_data[1], alt:chase_car_position.latest_data[2]};
        } else if (home_marker !== "NONE") {
            // Home marker is on the map - use the home marker position
            var _car = {lat:chase_config.default_lat, lon:chase_config.default_lon, alt:chase_config.default_alt};
        } else {
            // Otherwise, nothing we can use 
            var _car = null;
        }

        if(_car !== null){
            var _bal = {lat:_latest_telem.position[0], lon:_latest_telem.position[1], alt:_latest_telem.position[2]};
            var _look_angles = calculate_lookangles(_car, _bal);
            _summary_update.elevation = _look_angles.elevation.toFixed(0) + "°";
            _summary_update.azimuth = _look_angles.azimuth.toFixed(0) + "°";
            _summary_update.range = (_look_angles.range/1000).toFixed(1) + "km";
        }else{
            // No Chase car position data - insert dummy values
            _summary_update.azimuth = "---°";
            _summary_update.elevation = "--°";
            _summary_update.range = "----m";
        }

    }else{
        // No balloon data!
        _summary_update = {id: 1, alt:'-----m', speed:'---kph', vel_v:'-.-m/s', azimuth:'---°', elevation:'--°', range:'----m'}
    }
    // Update table
    $("#summary_table").tabulator("setData", [_summary_update]);
    if (summary_enlarged == true){
        var row = $("#summary_table").tabulator("getRow", 1);
        row.getElement().addClass("largeTableRow");
        $("#summary_table").tabulator("redraw", true);
    }
}
function updateSummaryDisplayImperial(){
    if ($("#summary_table").length === 0) {
        return;
    }
    
    // Update the 'Payload Summary' display.
    var _summary_update = {id:1};
    // See if there is any payload data.
    if (balloon_positions.hasOwnProperty(balloon_currently_following) == true){
        // There is balloon data!
        var _latest_telem = balloon_positions[balloon_currently_following].latest_data;
        
        _summary_update.alt = (_latest_telem.position[2]*3.28084).toFixed(0) + "ft (" + (_latest_telem.max_alt*3.28084).toFixed(0) + "ft)";
        var _speed = _latest_telem.speed*3.6 ;
        _summary_update.speed = (_speed*0.621371).toFixed(0) + " mph";
        _summary_update.vel_v = (_latest_telem.vel_v*3.28084*60).toFixed(0) + " ft/min";


        // Work out if we have data to calculate look-angles from.
        if (chase_car_position.latest_data.length == 3){
            // Chase car position available - use that.
            var _car = {lat:chase_car_position.latest_data[0], lon:chase_car_position.latest_data[1], alt:chase_car_position.latest_data[2]};
        } else if (home_marker !== "NONE") {
            // Home marker is on the map - use the home marker position
            var _car = {lat:chase_config.default_lat, lon:chase_config.default_lon, alt:chase_config.default_alt};
        } else {
            // Otherwise, nothing we can use 
            var _car = null;
        }

        if(_car !== null){
            // We have a chase car position! Calculate relative position.
            var _bal = {lat:_latest_telem.position[0], lon:_latest_telem.position[1], alt:_latest_telem.position[2]};
            var _look_angles = calculate_lookangles(_car, _bal);

            _summary_update.elevation = _look_angles.elevation.toFixed(0) + "°";
            _summary_update.azimuth = _look_angles.azimuth.toFixed(0) + "°";
            if (_look_angles.range > chase_config['switch_miles_feet']) {
              _summary_update.range = (_look_angles.range*0.621371/1000).toFixed(1) + " miles";
            } else {
              _summary_update.range = (_look_angles.range*3.28084).toFixed(1) + "ft";
            }
        }else{
            // No Chase car position data - insert dummy values
            _summary_update.azimuth = "---°";
            _summary_update.elevation = "--°";
            _summary_update.range = "----m";
        }

    }else{
        // No balloon data!
        _summary_update = {id: 1, alt:'-----m', speed:'---kph', vel_v:'-.-m/s', azimuth:'---°', elevation:'--°', range:'----m'}
    }
    // Update table
    $("#summary_table").tabulator("setData", [_summary_update]);
    if (summary_enlarged == true){
        var row = $("#summary_table").tabulator("getRow", 1);
        row.getElement().addClass("largeTableRow");
        $("#summary_table").tabulator("redraw", true);
    }
}

function handleTelemetry(data){
    // Telemetry Event messages contain a dictionary of position data.
    // It should have the fields:
    //  callsign: string
    //  position: [lat, lon, alt]
    //  vel_v: float
    //  time_to_landing: String
    // If callsign = 'CAR', the lat/lon/alt will be considered to be a car telemetry position.

    data = normalizeTelemetryForMap(data);
    if (!data) {
        return;
    }

    if(initial_load_complete == false){
        // If we have not completed our initial load of telemetry data, discard this data.
        return;
    }

    // Ignore non-APRS callsigns if an APRS allowlist is configured.
    try{
        if (data.callsign !== 'CAR' && typeof chase_config !== 'undefined' && Array.isArray(chase_config.aprs_callsigns) && chase_config.aprs_callsigns.length > 0){
            var csKey = (data.callsign || '').toString().toUpperCase();
            var allowed = chase_config.aprs_callsigns.some(function(x){ return (x||'').toString().toUpperCase() === csKey; });
            if (!allowed){
                // Not in APRS allowlist — ignore telemetry to avoid stray markers.
                console.debug('Ignoring telemetry for non-APRS callsign', csKey);
                return;
            }
        }
    }catch(e){ /* if anything goes wrong, proceed to handle telemetry */ }

    // Handle chase car position updates.
    if (data.callsign == 'CAR'){
        // Update car position.
        chase_car_position.latest_data = data.position;
        chase_car_position.heading = data.heading; // degrees true
        chase_car_position.heading_valid = data.heading_valid;
        chase_car_position.speed = data.speed; // m/s

        // Update range rings, if they are enabled.
        recenterRangeRings(data.position);

        // Update Detailed GPS / Heading Info
        if(data.hasOwnProperty('heading_status')){
            if(data.heading_status != null){
                $("#headingStatus").text(data.heading_status);

                if(data.heading_status.includes("Ongoing")){
                    $('#car_warning').text("IMU Not Aligned")
                    $('#car_warning').removeClass();
                    $('#car_warning').addClass('dataAgeBad');
                } else {
                    $('#car_warning').text("")
                }
            }
        }

        if(data.hasOwnProperty('numSV')){
            $("#numSVStatus").text(data.numSV.toFixed(0));
        }

        //console.log(data);

        // Update Chase Car Speed
        if (document.getElementById("showCarSpeed").checked){
            if (chase_config['unitselection'] == "imperial") {
		$("#chase_car_speed").text( (chase_car_position.speed*3.6*0.621371).toFixed(0) + " mph");
                } else {
		$("#chase_car_speed").text( (chase_car_position.speed*3.6).toFixed(0) + " kph");
                }
            $("#chase_car_speed_header").text("Chase Car Speed");
        } else {
            $("#chase_car_speed").text("");
            $("#chase_car_speed_header").text("");
        }

        if(data.hasOwnProperty('replay_time')){
            // Data is coming from a log file, display the time.
            $("#log_time").text(data.replay_time);
        }

        // Update heading information
        if (document.getElementById("showCarHeading").checked){
            $("#chase_car_heading").text(chase_car_position.heading.toFixed(0) + "˚");
            $("#chase_car_heading_header").text("Heading");
        } else {
            $("#chase_car_heading").text("");
            $("#chase_car_heading_header").text("");
        }

        if (chase_car_position.marker == 'NONE'){
            // Create marker!
            chase_car_position.marker = L.marker(chase_car_position.latest_data,{title:"Chase Car", icon: carIcon, rotationOrigin: "center center"})
                    .addTo(map);
            chase_car_position.path = L.polyline([chase_car_position.latest_data],{title:"Chase Car", color:'black', weight:1.5});
            // If the user wants the chase car tail, add it to the map.
            if (document.getElementById("chaseCarTrack").checked == true){
                chase_car_position.path.addTo(map);
            }
        } else {
            chase_car_position.path.addLatLng(chase_car_position.latest_data);
            chase_car_position.marker.setLatLng(chase_car_position.latest_data).update();
        }

        var _car_heading = chase_car_position.heading - 90.0;
        if (_car_heading<=90.0){
            chase_car_position.marker.setIcon(carIcon);
            chase_car_position.marker.setRotationAngle(_car_heading);
        }else{
            // We are travelling West - we need to use the flipped car icon.
            _car_heading = _car_heading - 180.0;
            chase_car_position.marker.setIcon(carIconFlip);
            chase_car_position.marker.setRotationAngle(_car_heading);
        }
        car_data_age = 0.0;
    }else{

        // Otherwise, we have a balloon
        if (balloon_positions.hasOwnProperty(data.callsign) == true){
            var _current_balloon = balloon_positions[data.callsign];
            if (_current_balloon.latest_data && _current_balloon.latest_data.server_time && data.hasOwnProperty('server_time') && data.server_time <= _current_balloon.latest_data.server_time){
                return;
            }
        }

        // Have we seen this ballon before? 
        if (balloon_positions.hasOwnProperty(data.callsign) == false){

            // Convert the incoming data into a format suitable for adding into the telem store.
            var temp_data = buildTelemetrySnapshotFromLiveData(data);

            // Add it to the telemetry store and create markers.
            var created = add_new_balloon(temp_data);
            if (!created || balloon_positions.hasOwnProperty(data.callsign) == false){
                return;
            }

            // Update data age to indicate current time.
            balloon_positions[data.callsign].age = Date.now();

        } else {
            // Yep - update the sonde_positions entry.
            balloon_positions[data.callsign].latest_data = data;
            balloon_positions[data.callsign].age = Date.now();
            balloon_positions[data.callsign].path.addLatLng(data.position);
            balloon_positions[data.callsign].marker.setLatLng(data.position).update();

            updateBalloonMarkerIcon(data.callsign, data);

            if(data.hasOwnProperty('snr') == true){
                balloon_positions[data.callsign].snr = data.snr;
            }

        }

        // Update the telemetry table display
        updateTelemetryTable();

        // Are we currently following any other sondes?
        if (balloon_currently_following === "none"){
            // If not, follow this one!
            balloon_currently_following = data.callsign;
        }

        // Update the Summary and time-to-landing displays
        if (balloon_currently_following === data.callsign){
            $('#time_to_landing').text(data.time_to_landing);
            payload_data_age = 0.0;
        }
    }

    // Auto Pan selection between balloon or car.
    var _current_follow = $('input[name=autoFollow]:checked').val();
    if ((_current_follow == 'payload') && (data.callsign == balloon_currently_following)){
        if (typeof window.panMapToVisibleCenter === 'function') {
            window.panMapToVisibleCenter(data.position);
        } else {
            map.panTo(data.position);
        }
    } else if (_current_follow == 'car' && data.callsign == 'CAR'){
        if (typeof window.panMapToVisibleCenter === 'function') {
            window.panMapToVisibleCenter(data.position);
        } else {
            map.panTo(data.position);
        }
    }else{
        // Don't pan to anything.
    }

    // Update the summary display.
    updateSummaryDisplay();
}

function handleModemStats(data){
    // Update balloon positions store with incoming modem statistics data (SNR).
    if (balloon_positions.hasOwnProperty(data.callsign) == true){
        balloon_positions[data.callsign].snr = data.snr;
    }
}

function hideBalloon(callsign){
    if (balloon_positions.hasOwnProperty(callsign) == true){
            balloon_positions[callsign].visible = false;
            // Remove the layers for this balloon from the map.
            if(map.hasLayer(balloon_positions[callsign].marker) == true){
                // Balloon is currently on the map, so remove it.
                // These two will always be on the map together.
                balloon_positions[callsign].marker.remove();
                balloon_positions[callsign].path.remove();
            }
            if(map.hasLayer(balloon_positions[callsign].burst_marker) == true){
                // Burst marker might not always be visible, i.e. after burst.
                balloon_positions[callsign].burst_marker.remove();
            }

            if(balloon_positions[callsign].pred_marker != null && map.hasLayer(balloon_positions[callsign].pred_marker) == true){
                balloon_positions[callsign].pred_marker.remove();
            }
            if(balloon_positions[callsign].pred_path != null && map.hasLayer(balloon_positions[callsign].pred_path) == true){
                balloon_positions[callsign].pred_path.remove();
            }
            if(map.hasLayer(balloon_positions[callsign].abort_marker) == true){
                // The same is true for the abort marker and path.
                balloon_positions[callsign].abort_marker.remove();
                balloon_positions[callsign].abort_path.remove();
            }
    }
}

function showBalloon(callsign){
    if (balloon_positions.hasOwnProperty(callsign) == true){
            balloon_positions[callsign].visible = true;
            // We can safely just add the balloon marker and path back onto the map.
            balloon_positions[callsign].marker.addTo(map);
            balloon_positions[callsign].path.addTo(map);
            
            if(balloon_positions[callsign].burst_marker != null){
                // The burst marker might not always be present.
                balloon_positions[callsign].burst_marker.addTo(map);
            }

            if(balloon_positions[callsign].pred_path != null){
                balloon_positions[callsign].pred_path.addTo(map);
            }

            if(balloon_positions[callsign].pred_marker != null){
                balloon_positions[callsign].pred_marker.addTo(map);
            }

            if(balloon_positions[callsign].abort_marker != null){
                balloon_positions[callsign].abort_marker.addTo(map);
                balloon_positions[callsign].abort_path.addTo(map);
            }

    }
}
