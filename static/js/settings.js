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
                    var li = $('<li>').addClass('list-group-item d-flex justify-content-between align-items-center aprs-item');
                    li.attr('data-callsign', cs.toUpperCase());
                    var left = $('<div>').addClass('d-flex align-items-center');
                    var name = $('<strong>').text(cs);
                    var timeSpan = $('<span>').addClass('aprs-last-time ms-2 text-muted').text('\u2014');
                    left.append(name).append(timeSpan);
                    var right = $('<div>');
                    var btn = $('<button type="button">').html('<i class="fa fa-trash" aria-hidden="true"></i>').addClass('btn btn-danger btn-sm aprs-remove-btn').data('callsign', cs).attr('title','Remove callsign');
                    right.append(btn);
                    li.append(left).append(right);
                    $('#aprsList').append(li);
                });
        }
        $('#aprsPollInterval').val(chase_config.aprs_poll_interval || 30);
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
	// Read in changs to various user-modifyable settings, and send updates to the server.
	chase_config.pred_enabled = document.getElementById("predictorEnabled").checked;
    chase_config.show_abort = document.getElementById("abortPredictionEnabled").checked;
    chase_config.habitat_upload_enabled = document.getElementById("habitatUploadEnabled").checked;
    chase_config.habitat_call = $('#habitatCall').val()

    // Attempt to parse the text field values.
    var _burst_alt = parseFloat($('#burstAlt').val());
    if (isNaN(_burst_alt) == false){
        chase_config.pred_burst = _burst_alt;
    }
    var _desc_rate = parseFloat($('#descentRate').val());
    if (isNaN(_desc_rate) == false){
        chase_config.pred_desc_rate = _desc_rate
    }
    var _update_rate = parseInt($('#predUpdateRate').val());
    if (isNaN(_update_rate) == false){
        chase_config.pred_update_rate = _update_rate
    }

    var _habitat_update_rate = parseInt($('#habitatUpdateRate').val());
    if (isNaN(_habitat_update_rate) == false){
        chase_config.habitat_update_rate = _habitat_update_rate
    }

    // Ensure APRS tracking is enabled by default
    chase_config.aprs_enabled = true;

    // Add in a selection of the bearing settings here.
    // These don't change anything on the backend, but need to be propagated to other clients.
    chase_config.time_seq_times = timeSeqTimes;
    chase_config.time_seq_enabled = timeSeqEnabled;
    chase_config.time_seq_active = timeSeqActive;
    chase_config.time_seq_cycle = timeSeqCycle;

    socket.emit('client_settings_update', chase_config);
};

// APRS UI helpers
$(document).on('click', '#aprsAddBtn', function(){
    var cs = $('#aprsCallInput').val().trim();
    if (cs === '') return;
    if (!chase_config.aprs_callsigns) chase_config.aprs_callsigns = [];
        if (chase_config.aprs_callsigns.indexOf(cs) === -1){
        chase_config.aprs_callsigns.push(cs);
        // update UI
        var li = $('<li>').addClass('list-group-item d-flex justify-content-between align-items-center');
        li.attr('data-callsign', cs.toUpperCase());
        var left = $('<div>').addClass('d-flex align-items-center');
        var name = $('<strong>').text(cs);
        var timeSpan = $('<span>').addClass('aprs-last-time ms-2 text-muted collecting').text('Collecting…');
        left.append(name).append(timeSpan);
        var right = $('<div>');
        var btn = $('<button type="button">').html('<i class="fa fa-trash" aria-hidden="true"></i>').addClass('btn btn-danger btn-sm aprs-remove-btn').data('callsign', cs).attr('title','Remove callsign');
        right.append(btn);
        li.append(left).append(right);
        $('#aprsList').append(li);
    }
    $('#aprsCallInput').val('');
    clientSettingsUpdate();
});

$(document).on('click', '.aprs-remove-btn', function(e){
    e = e || window.event;
    if (e.stopPropagation) e.stopPropagation();
    if (e.preventDefault) e.preventDefault();
    var cs = $(this).data('callsign');
    chase_config.aprs_callsigns = chase_config.aprs_callsigns.filter(function(x){return x !== cs});
    $(this).closest('li').remove();
    clientSettingsUpdate();
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
    }
});