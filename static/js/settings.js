//
//   Project Horus - Browser-Based Chase Mapper - Settings
//
//   Copyright (C) 2019  Mark Jessop <vk5qi@rfhead.net>
//   Released under GNU GPL v3 or later
//

// Global map settings
var prediction_opacity = 0.6;
var parachute_min_alt = 300; // Show the balloon as a 'landed' payload below this altitude.

var car_bad_age = 5.0;
var payload_bad_age = 30.0;


// Chase Mapper Configuration Parameters.
// These are dummy values which will be populated on startup.
var chase_config = {
    // Start location for the map (until either a chase car position, or balloon position is available.)
    // Default changed to Ann Arbor, MI
    default_lat: 42.2808,
    default_lon: -83.7430,

    // Predictor settings
    pred_enabled: true,  // Enable running and display of predicted flight paths.
    // Default prediction settings (actual values will be used once the flight is underway)
    pred_desc_rate: 6.0,
    pred_burst: 28000,
    pred_update_rate: 15,
    pred_model: 'Disabled',
    show_abort: true, // Show a prediction of an 'abort' paths (i.e. if the balloon bursts *now*)
    offline_tile_layers: [],
    habitat_call: 'N0CALL'
};

// APRS UI state cache keyed by uppercased callsign.
var aprs_telemetry_cache = {};
var aprs_last_rx_ms = {};

function getAprsStatusTimeoutMs() {
    var poll = parseInt(chase_config.aprs_poll_interval || 30, 10);
    if (isNaN(poll) || poll < 5) {
        poll = 30;
    }
    return Math.max(20000, ((poll * 3) + 10) * 1000);
}

function setAprsStatusDot(state, titleText) {
    var dot = $('#aprsStatusDot');
    if (dot.length === 0) {
        return;
    }
    dot.removeClass('aprs-status-good aprs-status-broken aprs-status-connecting');
    if (state === 'good') {
        dot.addClass('aprs-status-good');
    } else if (state === 'broken') {
        dot.addClass('aprs-status-broken');
    } else {
        dot.addClass('aprs-status-connecting');
    }
    dot.attr('title', titleText || 'APRS status');
}

function updateAprsStatusIndicator() {
    var calls = chase_config.aprs_callsigns || [];
    if (calls.length === 0) {
        setAprsStatusDot('broken', 'APRS status: broken (no callsigns configured)');
        return;
    }

    var now = Date.now();
    var timeoutMs = getAprsStatusTimeoutMs();
    var anySeen = false;
    var anyFresh = false;

    calls.forEach(function(cs) {
        var key = (cs || '').toString().toUpperCase();
        if (!key) {
            return;
        }
        if (aprs_last_rx_ms.hasOwnProperty(key)) {
            anySeen = true;
            if ((now - aprs_last_rx_ms[key]) <= timeoutMs) {
                anyFresh = true;
            }
        }
    });

    if (anyFresh) {
        setAprsStatusDot('good', 'APRS status: good (receiving data)');
    } else if (anySeen) {
        setAprsStatusDot('broken', 'APRS status: broken (no recent APRS data)');
    } else {
        setAprsStatusDot('connecting', 'APRS status: connecting');
    }
}

function getAprsReferencePosition() {
    if (typeof chase_car_position !== 'undefined' && chase_car_position.latest_data && chase_car_position.latest_data.length === 3) {
        return {
            lat: chase_car_position.latest_data[0],
            lon: chase_car_position.latest_data[1],
            alt: chase_car_position.latest_data[2]
        };
    }

    if (typeof chase_config !== 'undefined' && chase_config.default_lat !== undefined && chase_config.default_lon !== undefined) {
        return {
            lat: parseFloat(chase_config.default_lat),
            lon: parseFloat(chase_config.default_lon),
            alt: parseFloat(chase_config.default_alt || 0)
        };
    }

    return null;
}

function createAprsDetailRow(label, valueClass) {
    var row = $('<div>').addClass('aprs-detail-row');
    row.append($('<span>').addClass('aprs-detail-label').text(label));
    row.append($('<span>').addClass('aprs-detail-value ' + valueClass).text('\u2014'));
    return row;
}

function createAprsListItem(cs, collecting) {
    var csKey = (cs || '').toString().toUpperCase();
    var li = $('<li>').addClass('list-group-item aprs-item');
    li.attr('data-callsign', csKey);

    var row = $('<div>').addClass('d-flex justify-content-between align-items-start');
    var left = $('<div>').addClass('d-flex flex-column');
    var titleRow = $('<div>').addClass('d-flex align-items-center');
    var name = $('<strong>').text(csKey);
    var timeSpan = $('<span>').addClass('aprs-last-time ms-2 text-muted').text('\u2014');
    if (collecting) {
        timeSpan.addClass('collecting').text('Collecting...');
    }
    titleRow.append(name).append(timeSpan);

    var detailGrid = $('<div>').addClass('aprs-detail-grid mt-1');
    detailGrid.append(createAprsDetailRow('Alt', 'aprs-val-alt'));
    detailGrid.append(createAprsDetailRow('Speed', 'aprs-val-speed'));
    detailGrid.append(createAprsDetailRow('Ascent', 'aprs-val-ascent'));
    detailGrid.append(createAprsDetailRow('Az', 'aprs-val-az'));
    detailGrid.append(createAprsDetailRow('El', 'aprs-val-el'));
    detailGrid.append(createAprsDetailRow('Range', 'aprs-val-range'));

    left.append(titleRow).append(detailGrid);

    var right = $('<div>');
    var btn = $('<button type="button">')
        .html('<i class="fa fa-trash-o" aria-hidden="true"></i><span class="aprs-remove-fallback">Del</span>')
        .addClass('btn btn-danger btn-sm aprs-remove-btn')
        .data('callsign', csKey)
        .attr('title', 'Remove callsign')
        .attr('aria-label', 'Remove callsign ' + csKey);
    right.append(btn);

    row.append(left).append(right);
    li.append(row);

    return li;
}

function formatAprsTelemetryValue(telem) {
    var units = chase_config.unitselection || 'metric';
    var out = {
        alt: '\u2014',
        speed: '\u2014',
        ascent: '\u2014',
        az: '\u2014',
        el: '\u2014',
        range: '\u2014'
    };

    if (!telem || !telem.position || telem.position.length < 3) {
        return out;
    }

    var altM = parseFloat(telem.position[2]);
    if (!isNaN(altM)) {
        out.alt = (units === 'imperial') ? ((altM * 3.28084).toFixed(0) + ' ft') : (altM.toFixed(0) + ' m');
    }

    var speedMs = parseFloat(telem.speed);
    if (!isNaN(speedMs)) {
        out.speed = (units === 'imperial') ? ((speedMs * 2.236936).toFixed(0) + ' mph') : ((speedMs * 3.6).toFixed(0) + ' kph');
    }

    var ascentMs = parseFloat(telem.vel_v);
    if (!isNaN(ascentMs)) {
        out.ascent = (units === 'imperial') ? ((ascentMs * 196.850394).toFixed(0) + ' ft/min') : (ascentMs.toFixed(1) + ' m/s');
    }

    var origin = getAprsReferencePosition();
    if (origin !== null && !isNaN(origin.lat) && !isNaN(origin.lon)) {
        var target = {lat: parseFloat(telem.position[0]), lon: parseFloat(telem.position[1]), alt: altM};
        if (!isNaN(target.lat) && !isNaN(target.lon) && typeof calculate_lookangles === 'function') {
            var look = calculate_lookangles({lat: origin.lat, lon: origin.lon, alt: origin.alt || 0}, target);
            out.az = look.azimuth.toFixed(0) + '\u00b0';
            out.el = look.elevation.toFixed(0) + '\u00b0';
            if (units === 'imperial') {
                if (look.range > (chase_config.switch_miles_feet || 1609.34)) {
                    out.range = (look.range * 0.000621371).toFixed(1) + ' mi';
                } else {
                    out.range = (look.range * 3.28084).toFixed(0) + ' ft';
                }
            } else {
                out.range = (look.range / 1000.0).toFixed(1) + ' km';
            }
        }
    }

    return out;
}

function renderAprsTelemetryRow(cs) {
    var csKey = (cs || '').toString().toUpperCase();
    var item = $('#aprsList').find('li[data-callsign="' + csKey + '"]');
    if (item.length === 0) {
        return;
    }

    var telem = aprs_telemetry_cache[csKey];
    if (!telem) {
        return;
    }

    var timeText = telem.short_time || '';
    if (!timeText && telem.server_time) {
        var d = new Date(Math.floor(telem.server_time) * 1000);
        timeText = d.toISOString().replace('T', ' ').split('.')[0];
    }
    if (!timeText) {
        timeText = '\u2014';
    }
    item.find('.aprs-last-time').removeClass('collecting').text(timeText);

    var values = formatAprsTelemetryValue(telem);
    item.find('.aprs-val-alt').text(values.alt);
    item.find('.aprs-val-speed').text(values.speed);
    item.find('.aprs-val-ascent').text(values.ascent);
    item.find('.aprs-val-az').text(values.az);
    item.find('.aprs-val-el').text(values.el);
    item.find('.aprs-val-range').text(values.range);
}

function refreshAprsTelemetryRows() {
    var calls = chase_config.aprs_callsigns || [];
    calls.forEach(function(cs) {
        renderAprsTelemetryRow(cs);
    });
}

function updateAprsTelemetryRow(telem) {
    if (!telem || !telem.callsign) {
        return;
    }

    var csKey = (telem.callsign || '').toString().toUpperCase();
    if (!csKey) {
        return;
    }

    aprs_telemetry_cache[csKey] = telem;
    if (telem.server_time) {
        aprs_last_rx_ms[csKey] = Math.floor(telem.server_time * 1000);
    } else {
        aprs_last_rx_ms[csKey] = Date.now();
    }

    if (csKey === 'CAR') {
        refreshAprsTelemetryRows();
        return;
    }

    var hasRow = $('#aprsList').find('li[data-callsign="' + csKey + '"]').length > 0;
    if (!hasRow) {
        return;
    }

    renderAprsTelemetryRow(csKey);
    updateAprsStatusIndicator();
}


function serverSettingsUpdate(data){
    // Accept a json blob of settings data from the client, and update our local store.
    chase_config = data;
    // Update a few fields based on this data.
    $("#predictorModelValue").text(chase_config.pred_model);
    $('#burstAlt').val(chase_config.pred_burst.toFixed(0));
    $('#descentRate').val(chase_config.pred_desc_rate.toFixed(1));
    $('#predUpdateRate').val(chase_config.pred_update_rate.toFixed(0));
    $('#habitatUpdateRate').val(chase_config.habitat_update_rate.toFixed(0));
    $("#predictorEnabled").prop('checked', chase_config.pred_enabled);
    $("#habitatUploadEnabled").prop('checked', chase_config.habitat_upload_enabled);
    $("#showOtherCars").prop('checked', chase_config.habitat_upload_enabled);
    $("#habitatCall").val(chase_config.habitat_call);
    $("#abortPredictionEnabled").prop('checked', chase_config.show_abort);

    // Range ring settings.
    $('#ringQuantity').val(chase_config.range_ring_quantity.toFixed(0));
    $('#ringSpacing').val(chase_config.range_ring_spacing.toFixed(0));
    $('#ringWeight').val(chase_config.range_ring_weight.toFixed(1));
    $('#ringColorSelect').val(chase_config.range_ring_color);
    $('#ringCustomColor').val(chase_config.range_ring_custom_color);
    $('#rangeRingsEnabled').prop('checked', chase_config.range_rings_enabled);
    
    // Chase Car Speedometer
    $('#showCarSpeed').prop('checked', chase_config.chase_car_speed);

    // APRS settings
    try {
        // populate callsigns list (with last-beacon timestamp placeholder)
        $('#aprsList').empty();
        if (chase_config.aprs_callsigns && chase_config.aprs_callsigns.length > 0){
            chase_config.aprs_callsigns.forEach(function(cs){
                var key = (cs || '').toString().toUpperCase();
                if (!key) {
                    return;
                }
                $('#aprsList').append(createAprsListItem(key, false));
                if (!aprs_telemetry_cache[key] && typeof balloon_positions !== 'undefined' && balloon_positions[key] && balloon_positions[key].latest_data) {
                    aprs_telemetry_cache[key] = balloon_positions[key].latest_data;
                    aprs_last_rx_ms[key] = Date.now();
                }
                renderAprsTelemetryRow(key);
            });
        }
        $('#aprsPollInterval').val(chase_config.aprs_poll_interval || 30);
        updateAprsStatusIndicator();
    } catch (e){
        // ignore if not present
    }

    // Bearing settings
    $('#bearingLength').val(chase_config.bearing_length.toFixed(0));
    $('#bearingWeight').val(chase_config.bearing_weight.toFixed(1));
    $('#bearingColorSelect').val(chase_config.bearing_color);
    $('#bearingCustomColor').val(chase_config.bearing_custom_color);
    $('#bearingMaximumAge').val((chase_config.max_bearing_age/60.0).toFixed(0));
    $('#bearingConfidenceThreshold').val(chase_config.doa_confidence_threshold.toFixed(1));

    $('#bearingsOnlyMode').prop('checked', chase_config.bearings_only_mode);
    toggleBearingsOnlyMode()
    // Add new time sync bearing settings here

    timeSeqEnabled = chase_config.time_seq_enabled;
    $("#timeSeqEnabled").prop('checked', timeSeqEnabled);
    timeSeqActive = chase_config.time_seq_active;
    timeSeqCycle = chase_config.time_seq_cycle;
    timeSeqTimes = chase_config.time_seq_times;
    updateTimeSeqStatus();


    // Clear and populate the profile selection.
    $('#profileSelect').children('option:not(:first)').remove();

    $.each(chase_config.profiles, function(key, value) {
         $('#profileSelect')
             .append($("<option></option>")
             .attr("value",key)
             .text(key));
    });
    $("#profileSelect").val(chase_config.selected_profile);

    // Update version
    $('#chasemapper_version').html(chase_config.version);

}

function clientSettingsUpdate(){
	// Read in changes to user-modifiable settings that are currently present in the UI.
	var _predictorEnabled = document.getElementById("predictorEnabled");
    if (_predictorEnabled) {
        chase_config.pred_enabled = _predictorEnabled.checked;
    }

    var _abortPredictionEnabled = document.getElementById("abortPredictionEnabled");
    if (_abortPredictionEnabled) {
        chase_config.show_abort = _abortPredictionEnabled.checked;
    }

    var _habitatUploadEnabled = document.getElementById("habitatUploadEnabled");
    if (_habitatUploadEnabled) {
        chase_config.habitat_upload_enabled = _habitatUploadEnabled.checked;
    }

    if ($('#habitatCall').length > 0) {
        chase_config.habitat_call = $('#habitatCall').val();
    }

    // Attempt to parse the text field values.
    var _burst_alt = parseFloat($('#burstAlt').val());
    if ($('#burstAlt').length > 0 && isNaN(_burst_alt) == false){
        chase_config.pred_burst = _burst_alt;
    }
    var _desc_rate = parseFloat($('#descentRate').val());
    if ($('#descentRate').length > 0 && isNaN(_desc_rate) == false){
        chase_config.pred_desc_rate = _desc_rate
    }
    var _update_rate = parseInt($('#predUpdateRate').val());
    if ($('#predUpdateRate').length > 0 && isNaN(_update_rate) == false){
        chase_config.pred_update_rate = _update_rate
    }

    var _habitat_update_rate = parseInt($('#habitatUpdateRate').val());
    if ($('#habitatUpdateRate').length > 0 && isNaN(_habitat_update_rate) == false){
        chase_config.habitat_update_rate = _habitat_update_rate
    }

    // Ensure APRS tracking is enabled by default
    chase_config.aprs_enabled = true;

    // Add in a selection of the bearing settings here.
    // These don't change anything on the backend, but need to be propagated to other clients.
    if (typeof timeSeqTimes !== 'undefined') chase_config.time_seq_times = timeSeqTimes;
    if (typeof timeSeqEnabled !== 'undefined') chase_config.time_seq_enabled = timeSeqEnabled;
    if (typeof timeSeqActive !== 'undefined') chase_config.time_seq_active = timeSeqActive;
    if (typeof timeSeqCycle !== 'undefined') chase_config.time_seq_cycle = timeSeqCycle;

    if (typeof socket !== 'undefined' && socket) {
        socket.emit('client_settings_update', chase_config);
    } else {
        console.warn('Socket is not ready; unable to send settings update.');
    }
};

// APRS UI helpers
$(document).on('click', '#aprsAddBtn', function(){
    var cs = $('#aprsCallInput').val().trim();
    if (cs === '') return;
    cs = cs.toUpperCase();
    if (!chase_config.aprs_callsigns) chase_config.aprs_callsigns = [];
    if (chase_config.aprs_callsigns.indexOf(cs) === -1){
        chase_config.aprs_callsigns.push(cs);
        $('#aprsList').append(createAprsListItem(cs, true));
    }
    $('#aprsCallInput').val('');
    clientSettingsUpdate();
    updateAprsStatusIndicator();
});

$(document).on('keydown', '#aprsCallInput', function(e){
    if (e.key === 'Enter' || e.which === 13) {
        e.preventDefault();
        $('#aprsAddBtn').trigger('click');
    }
});

$(document).on('click', '.aprs-remove-btn', function(e){
    e = e || window.event;
    if (e.stopPropagation) e.stopPropagation();
    if (e.preventDefault) e.preventDefault();
    var cs = ($(this).data('callsign') || '').toString().toUpperCase();
    chase_config.aprs_callsigns = chase_config.aprs_callsigns.filter(function(x){
        return (x || '').toString().toUpperCase() !== cs;
    });
    delete aprs_telemetry_cache[cs];
    delete aprs_last_rx_ms[cs];
    $(this).closest('li').remove();
    clientSettingsUpdate();
    updateAprsStatusIndicator();
});

// Theme selector and use-current-location handler
$(document).on('change', '#themeSelect', function(){
    var val = $(this).val();
    localStorage.setItem('chasemapper_theme', val);
    if (val === 'dark') applyTheme(true); else applyTheme(false);
});

$(document).on('click', '#useCurrentLocation', function(){
    if (navigator && navigator.geolocation){
        navigator.geolocation.getCurrentPosition(function(pos){
            $('#currentLocationDisplay').text(pos.coords.latitude.toFixed(5)+', '+pos.coords.longitude.toFixed(5));
            chase_config.default_lat = pos.coords.latitude;
            chase_config.default_lon = pos.coords.longitude;
            clientSettingsUpdate();
        }, function(err){ alert('Unable to get location: '+(err && err.message)); });
    } else {
        alert('Geolocation not available');
    }
});

// Manual apply location
$(document).on('click', '#applyLocation', function(){
    var lat = parseFloat($('#currentLat').val());
    var lon = parseFloat($('#currentLon').val());
    if (isNaN(lat) || isNaN(lon)){
        alert('Please enter valid numeric latitude and longitude');
        return;
    }
    $('#currentLocationDisplay').text(lat.toFixed(5)+', '+lon.toFixed(5));
    chase_config.default_lat = lat;
    chase_config.default_lon = lon;
    clientSettingsUpdate();
});



$(document).on('change', '#aprsPollInterval', function(){
    var v = parseInt($('#aprsPollInterval').val());
    if (!isNaN(v)){
        chase_config.aprs_poll_interval = v;
        clientSettingsUpdate();
        updateAprsStatusIndicator();
    }
});

window.setInterval(function(){
    updateAprsStatusIndicator();
}, 2000);