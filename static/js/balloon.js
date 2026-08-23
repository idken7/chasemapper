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

// Standard great-circle (Haversine) distance in metres between two [lat,lon]
// points - matches Leaflet's LatLng.distanceTo(), which this replaces.
function haversineMetres(lat1, lon1, lat2, lon2){
    var R = 6371000;
    var toRad = Math.PI / 180;
    var dLat = (lat2 - lat1) * toRad;
    var dLon = (lon2 - lon1) * toRad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
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

    var existingBalloon = balloon_positions.hasOwnProperty(callsign) ? balloon_positions[callsign] : null;

    balloon_positions[callsign] = existingBalloon || {};
    balloon_positions[callsign].latest_data = telem;
    balloon_positions[callsign].age = 0;
    if (!balloon_positions[callsign].colour) {
        balloon_positions[callsign].colour = colour_values[colour_idx];
    }
    balloon_positions[callsign].snr = -255.0;
    balloon_positions[callsign].visible = true;
    balloon_positions[callsign].pred_age = balloon_positions[callsign].pred_age || 0;

    balloon_positions[callsign].path = pathData;
    balloon_positions[callsign].pred_path = predPathData;
    balloon_positions[callsign].pred_marker = (predLandingData.length == 3) ? predLandingData : null;
    balloon_positions[callsign].burst_marker = (burstData.length == 3) ? burstData : null;
    balloon_positions[callsign].abort_path = abortPathData;
    balloon_positions[callsign].abort_marker = (abortLandingData.length == 3) ? abortLandingData : null;

    // If the balloon is in descent, or is above the burst altitude, clear out
    // the abort path/marker so they don't get shown.
    if (telem.position[2] > chase_config.pred_burst || telem.vel_v < 0.0){
        balloon_positions[callsign].abort_path = [];
        balloon_positions[callsign].abort_marker = null;
    }

    if (typeof syncCesiumAfterBalloonUpdate === 'function') {
        syncCesiumAfterBalloonUpdate(callsign, {
            telem: telem,
            pathData: balloon_positions[callsign].path,
            predPathData: balloon_positions[callsign].pred_path,
            predLandingData: balloon_positions[callsign].pred_marker,
            burstData: balloon_positions[callsign].burst_marker,
            abortPathData: balloon_positions[callsign].abort_path,
            abortLandingData: balloon_positions[callsign].abort_marker,
            visible: balloon_positions[callsign].visible
        });
    }

    if (typeof flushPendingPrediction === 'function'){
        flushPendingPrediction(callsign);
    }

    colour_idx = (colour_idx+1)%colour_values.length;

    return true;

}

// Updates the bottom-left "Flight Deck" telemetry readout card (callsign,
// altitude, distance-to-chase-car, ETA, descent rate) for whichever payload
// is currently being followed. Called on every telemetry update for that
// payload; falls back to '—' for any value we can't compute yet.
function updateTelemReadoutCard(data){
    var $card = $('#telemReadoutCard');
    if ($card.length === 0) {
        return;
    }

    $card.show();
    $('#telemReadoutCallsign').text(data.callsign || '—');

    var alt = (Array.isArray(data.position) && data.position.length > 2) ? data.position[2] : null;
    $('#telemReadoutAlt').text(isFinite(alt) ? ('ALT ' + Math.round(alt) + 'm') : '—');

    var descent = isFinite(data.vel_v) ? data.vel_v : NaN;
    if (isFinite(descent)) {
        $('#telemReadoutDescent').html(Math.abs(descent).toFixed(1) + '<span class="telem-readout-unit">m/s</span>');
    } else {
        $('#telemReadoutDescent').text('—');
    }

    $('#telemReadoutEta').text(data.time_to_landing || '—');

    try {
        if (typeof chase_car_position !== 'undefined' && Array.isArray(chase_car_position.latest_data) && chase_car_position.latest_data.length >= 2 && Array.isArray(data.position)) {
            var distMetres = haversineMetres(chase_car_position.latest_data[0], chase_car_position.latest_data[1], data.position[0], data.position[1]);
            var distKm = distMetres / 1000.0;
            $('#telemReadoutDist').html(distKm.toFixed(1) + '<span class="telem-readout-unit">km</span>');
        } else {
            $('#telemReadoutDist').text('—');
        }
    } catch (e) {
        $('#telemReadoutDist').text('—');
    }
}
window.updateTelemReadoutCard = updateTelemReadoutCard;

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
      if (!isMyOwnCarTelemetry(data)){
        // This is another connected chaser's position (or, if we're sharing
        // our own device location, the primary/hardware-fed car) - render it
        // as a distinct marker rather than overwriting our own car.
        handleOtherChaserTelemetry(data);
        return;
      }
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
        if (getCheckboxState("showCarSpeed", false)){
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

        // Update heading information. The showCarHeading control may not be
        // present in the current UI, so guard against a missing element
        // (defaults to hiding the heading text).
        if (getCheckboxState("showCarHeading", false)){
            $("#chase_car_heading").text(chase_car_position.heading.toFixed(0) + "˚");
            $("#chase_car_heading_header").text("Heading");
        } else {
            $("#chase_car_heading").text("");
            $("#chase_car_heading_header").text("");
        }

        if (!chase_car_position.active){
            // First fix - start the breadcrumb tail.
            chase_car_position.active = true;
            chase_car_position.path = [chase_car_position.latest_data];
        } else {
            addBoundedLatLng(chase_car_position.path, chase_car_position.latest_data);
        }

        car_data_age = 0.0;
        if (typeof syncCesiumAfterCarUpdate === 'function') {
            syncCesiumAfterCarUpdate();
        }
        if (typeof updateChaserRosterDisplay === 'function') {
            updateChaserRosterDisplay();
        }
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
            addBoundedLatLng(balloon_positions[data.callsign].path, data.position);

                // Building pathData/predPathData/abortPathData below copies the entire
                // (unbounded, multi-hour) polyline on every single telemetry message.
                // Skip that work entirely when the 3D view isn't even active to consume it.
                if (typeof syncCesiumAfterBalloonUpdate === 'function' && (typeof isCesiumActive !== 'function' || isCesiumActive())) {
                    syncCesiumAfterBalloonUpdate(data.callsign, {
                        telem: data,
                        pathData: balloon_positions[data.callsign].path,
                        predPathData: balloon_positions[data.callsign].pred_path || [],
                        predLandingData: balloon_positions[data.callsign].pred_marker || null,
                        burstData: balloon_positions[data.callsign].burst_marker || null,
                        abortPathData: balloon_positions[data.callsign].abort_path || [],
                        abortLandingData: balloon_positions[data.callsign].abort_marker || null,
                        visible: balloon_positions[data.callsign].visible
                    });
                }

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
            updateTelemReadoutCard(data);
            payload_data_age = 0.0;
        }
    }

    // Auto Pan selection between balloon or car.
    var _current_follow = $('input[name=autoFollow]:checked').val();
    if ((_current_follow == 'payload') && (data.callsign == balloon_currently_following)){
        if (typeof window.panMapToVisibleCenter === 'function') {
            window.panMapToVisibleCenter(data.position);
        }
    } else if (_current_follow == 'car' && data.callsign == 'CAR'){
        if (typeof window.panMapToVisibleCenter === 'function') {
            window.panMapToVisibleCenter(data.position);
        }
    }else{
        // Don't pan to anything.
    }
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
        if (typeof syncCesiumAfterBalloonUpdate === 'function') {
            syncCesiumAfterBalloonUpdate(callsign, {visible: false});
        }
    }
}

function showBalloon(callsign){
    if (balloon_positions.hasOwnProperty(callsign) == true){
        balloon_positions[callsign].visible = true;
        if (typeof syncCesiumAfterBalloonUpdate === 'function') {
            syncCesiumAfterBalloonUpdate(callsign, {visible: true});
        }
    }
}
