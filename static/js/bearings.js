//
//   Project Horus - Browser-Based Chase Mapper - Bearing Handlers
//
//   Copyright (C) 2019  Mark Jessop <vk5qi@rfhead.net>
//   Released under GNU GPL v3 or later
//
//
//	 TODO:
//		[x] Update bearing settings on change of fields
//		[ ] Check what's up with the opacity scaling (make it properly linear)
//		[ ] Load in default values from config file on startup
//		[ ] Add compass widget to map to show latest bearing data.
//
//

var bearing_store = {};

var bearing_sources = [];

var bearings_on = true;
var bearings_only_mode = false;


var bearing_confidence_threshold = 5.0;
var bearing_max_age = 10*60.0;

var bearing_length = 10000;
var bearing_weight = 1.0;
var manual_bearing_weight = 5.0; // Should probably add this to a setting
var bearing_color = "#000000";
var bearing_max_opacity = 0.8;
var bearing_min_opacity = 0.1;

// If any of these tags are in the bearing source name, we consider this a 'manual' bearing and make the line thicker.
var manual_bearing_sources = ["BPI", "manual", "EasyBearing"];

var bearing_large_plot = false;

// Store for the latest server timestamp.
// Start out with just our own local timestamp.
var latest_server_timestamp = Date.now()/1000.0;

// Time-Sequenced Transmitter Code
// ... which is entirely specific to one event at the Mt Gambier Convention,
// yet took me ages to write.

// These values are set to a instantaneous time when a button is clicked.
var timeSeqEnabled = false;
var timeSeqActive = 25;
var timeSeqCycle = 120;
var timeSeqTimes = [0,0,0,0];


function updateBearingSettings(){
	// Update bearing settings, but do *not* redraw. Several of these inputs
	// were removed from the page in an earlier GUI refactor (see
	// getCheckboxState's comment in utils.js) but this function still tries
	// to read them - guard every parse against NaN/undefined and fall back
	// to the current value, so a missing control can't corrupt these (and,
	// below, can't get persisted as a broken localStorage value either).
	var _weight = parseFloat($('#bearingWeight').val());
	if (!isNaN(_weight)) bearing_weight = _weight;

	var _manual_weight = parseFloat($('#manualBearingWeight').val());
	if (!isNaN(_manual_weight)) manual_bearing_weight = _manual_weight;

	var _length_km = parseFloat($('#bearingLength').val());
	if (!isNaN(_length_km)) bearing_length = _length_km * 1000;

	var _confidence = parseFloat($('#bearingConfidenceThreshold').val());
	if (!isNaN(_confidence)) bearing_confidence_threshold = _confidence;

	var _max_age = parseFloat($('#bearingMaximumAge').val());
	if (!isNaN(_max_age)) bearing_max_age = _max_age * 60.0;

	var _min_opacity = parseFloat($('#bearingMinOpacity').val());
	if (!isNaN(_min_opacity)) bearing_min_opacity = _min_opacity;

	var _max_opacity = parseFloat($('#bearingMaxOpacity').val());
	if (!isNaN(_max_opacity)) bearing_max_opacity = _max_opacity;

	var _bearing_color = $('#bearingColorSelect').val();
	var _bearing_custom_color = $('#bearingCustomColor').val();

	if(_bearing_color == "red"){
		bearing_color = "#FF0000";
	} else if (_bearing_color == "black"){
		bearing_color = "#000000";
	} else if (_bearing_color == "blue"){
		bearing_color = "#0000FF";
	} else if (_bearing_color == "green"){
		bearing_color = "#00AA00";
	} else if (_bearing_color == "white"){
		bearing_color = "#FFFFFF";
	} else if (_bearing_color == "custom"){
		bearing_color = _bearing_custom_color;
	}
	// else: control is absent - leave bearing_color as whatever it already was.

	// Persist as personal display preferences (never sent to the server),
	// only when we actually read a valid value.
	if (typeof setLocalDisplaySetting === 'function'){
		if (!isNaN(_weight)) setLocalDisplaySetting('bearing_weight', bearing_weight);
		if (!isNaN(_length_km)) setLocalDisplaySetting('bearing_length', _length_km);
		if (!isNaN(_confidence)) setLocalDisplaySetting('doa_confidence_threshold', bearing_confidence_threshold);
		if (_bearing_color) setLocalDisplaySetting('bearing_color', _bearing_color);
		if (_bearing_custom_color) setLocalDisplaySetting('bearing_custom_color', _bearing_custom_color);
	}
}

function destroyAllBearings(){
	$.each(bearing_store, function(key, value) {
		bearing_store[key].line.remove();
	});

	bearing_store = {};
	//bearing_sources = [];
}


// bearing.source is now sometimes a free-text name (e.g. "EasyBearing: VK5QI",
// with the name coming from a user's own chosen chaser name) rather than a
// fixed hardware label. Build the per-source filter checkbox's DOM id from a
// sanitized version of it, since jQuery's "#id" selector syntax interprets
// unescaped ':' and other special characters as CSS pseudo-selectors and
// would break/misbehave otherwise.
function bearingSourceElementId(source){
	return "bearing_source_" + (source || '').toString().replace(/[^a-zA-Z0-9_-]/g, '_');
}

// Colour-codes bearing lines by source, so if more than one person is
// submitting bearings at once (see add_manual_bearing / bearingEntry.html /
// oclock.html), whose is whose is visually distinguishable rather than every
// line rendering identically. The first source seen this session keeps
// tracking the user's own configured bearing_color setting exactly as
// before (so a single-source setup looks unchanged); each additional
// distinct source gets a fixed colour from a small palette.
var bearing_source_colours = {};
var bearing_primary_source = null;
var bearing_source_colour_idx = 0;
var bearing_source_colour_palette = ['#e74c3c', '#2ecc71', '#9b59b6', '#1abc9c', '#e67e22', '#3498db'];

function getBearingLineColour(source){
	if (bearing_primary_source === null){
		bearing_primary_source = source;
	}
	if (source === bearing_primary_source){
		return bearing_color;
	}
	if (!bearing_source_colours.hasOwnProperty(source)){
		bearing_source_colours[source] = bearing_source_colour_palette[bearing_source_colour_idx % bearing_source_colour_palette.length];
		bearing_source_colour_idx++;
	}
	return bearing_source_colours[source];
}

function bearingValid(bearing){
	// Decide if a bearing should be plotted on the map, based on user options.
	var _show_bearing = false;

	// Filter out bearings below our confidence threshold.
	if (bearing.confidence > bearing_confidence_threshold){

		if (bearing.heading_valid == false) {
			// Only show bearings which have an invalid associated hearing if the user wants them.
			_show_bearing = getCheckboxState("showStationaryBearings", false);

		} else {
			_show_bearing = true;
		}
	}

	// Disable showing of this bearing if the source is not selected
	var _sourceCheckbox = document.getElementById(bearingSourceElementId(bearing.source));
	if (_sourceCheckbox && !_sourceCheckbox.checked){
		_show_bearing = false;
	}

	return _show_bearing;
}

function addBearing(timestamp, bearing, live){


	// Handle any raw data, if we have been passed it.
	var _raw_bearing_angles = [];
	var _raw_doa = [];
	if(bearing.hasOwnProperty('raw_bearing_angles')){
		// If we have raw data provided, extract it, then delete it from the bearing object,
		// as we don't want to store this persistently.
		_raw_bearing_angles = bearing.raw_bearing_angles;
		_raw_doa = bearing.raw_doa;
		delete bearing.raw_bearing_angles;
		delete bearing.raw_doa;
	}

	//console.log(timestamp);

	bearing_store[timestamp] = bearing;

	if (timeSeqEnabled){
		// Check if this bearing is from the current time-sequenced transmitter.
		var _current_seq = getCurrentSeqNumber();
		if (_current_seq >= 0){
			bearing.source = bearing.source + "_Fox" + _current_seq;
		}
		updateTimeSeqStatus();
	}

	if ( !bearing_sources.includes(bearing.source)){
		bearing_sources.push(bearing.source);
		// bearing.source may now contain a free-text name (see comment on
		// bearingSourceElementId above) - escape it for display, and derive
		// a sanitized id for the checkbox rather than using it verbatim.
		_new_bearing_div_name = bearingSourceElementId(bearing.source);
		bearing_sources_div = "<div class='paramRow'><b>Source: " + escapeHtml(bearing.source) + "</b> <input type='checkbox' class='paramSelector' id='"+_new_bearing_div_name+"'></div>";
		$("#bearing_source_selector").append(bearing_sources_div);
		$(document.getElementById(_new_bearing_div_name)).prop('checked',true);

		$(document.getElementById(_new_bearing_div_name)).on('change', function(){
			redrawBearings();
		});
	}

	// Calculate the end position.
	var _end = calculateDestination(L.latLng([bearing_store[timestamp].lat, bearing_store[timestamp].lon]), bearing_store[timestamp].true_bearing, bearing_length);

	var _opacity = calculateBearingOpacity(timestamp);

	var _is_manual_bearing = manual_bearing_sources.some(function (s) {
		return bearing.source.toLowerCase().includes(s.toLowerCase());
	});

	if(_is_manual_bearing){
		var _temp_bearing_weight = manual_bearing_weight;
	} else {
		var _temp_bearing_weight = bearing_weight;
	}

	// Create the PolyLine
	bearing_store[timestamp].line = L.polyline(
		[[bearing_store[timestamp].lat, bearing_store[timestamp].lon],_end],{
			color: getBearingLineColour(bearing_store[timestamp].source),
			weight: _temp_bearing_weight,
			opacity: _opacity
		});

	_bearing_valid = bearingValid(bearing_store[timestamp]);
	if ( (_bearing_valid == true) && (getCheckboxState("bearingsEnabled", true) == true) ){
		bearing_store[timestamp].line.addTo(map);
	}

	if ( (live == true) && (getCheckboxState("bearingsEnabled", true) == true) ){
		
		if(_raw_bearing_angles.length > 0){
			if (bearing_store[timestamp].confidence > bearing_confidence_threshold){
				_valid_text = "YES";
			}else {
				_valid_text = "NO";
			}
			$("#bearing_table").tabulator("setData", [{id:1, valid_bearing:_valid_text, bearing: bearing_store[timestamp].raw_bearing.toFixed(0), confidence: bearing_store[timestamp].confidence.toFixed(1), power: bearing_store[timestamp].power.toFixed(0)}]);
			$("#bearing_table").show();

			if(getCheckboxState("tdoaEnabled", true) == true){
				_valid_tdoa = bearing_store[timestamp].confidence > bearing_confidence_threshold;
				bearingPlotRender(_raw_bearing_angles, _raw_doa, _valid_tdoa);
				$('#bearing_plot').show();
			}else{
				$('#bearing_plot').hide();
			}
		}
	}

}


function removeBearings(timestamps){
	// Remove bearings from a supplied list
	timestamps.forEach(function (item, index){
		if(bearing_store.hasOwnProperty(item)){
			bearing_store[item].line.remove();
			delete bearing_store[item];
			console.log(item);
		}
	});

}


function restyleBearings(){
	// Update the bearing settings.
	updateBearingSettings();


	$.each(bearing_store, function(key, value) {
		// Calculate the end position.
		var _opacity = calculateBearingOpacity(key);

		var _is_manual_bearing = manual_bearing_sources.some(function (s) {
			return bearing_store[key].source.toLowerCase().includes(s.toLowerCase());
		});

		if(_is_manual_bearing){
			var _temp_bearing_weight = manual_bearing_weight;
		} else {
			var _temp_bearing_weight = bearing_weight;
		}

		// Create the PolyLine
		bearing_store[key].line.setStyle({
				color: getBearingLineColour(bearing_store[key].source),
				weight: _temp_bearing_weight,
				opacity: _opacity
			});

	});
}


function redrawBearings(){
	// Update the bearing settings.
	updateBearingSettings();


	$.each(bearing_store, function(key, value) {
		// Remove bearing from map.
		bearing_store[key].line.remove();

		// Calculate the end position.
		var _end = calculateDestination(L.latLng([bearing_store[key].lat, bearing_store[key].lon]), bearing_store[key].true_bearing, bearing_length);
		var _opacity = calculateBearingOpacity(key);

		var _is_manual_bearing = manual_bearing_sources.some(function (s) {
			return bearing_store[key].source.toLowerCase().includes(s.toLowerCase());
		});

		if(_is_manual_bearing){
			var _temp_bearing_weight = manual_bearing_weight;
		} else {
			var _temp_bearing_weight = bearing_weight;
		}

		// Create the PolyLine
		bearing_store[key].line = L.polyline(
			[[bearing_store[key].lat, bearing_store[key].lon],_end],{
				color: getBearingLineColour(bearing_store[key].source),
				weight: _temp_bearing_weight,
				opacity: _opacity
			});

		if ( (bearingValid(bearing_store[key]) == true) && (getCheckboxState("bearingsEnabled", true) == true)){
			bearing_store[key].line.addTo(map);
		}

	});
}


function initialiseBearings(){

	// Destroy all existing bearings
	destroyAllBearings();

	// Update the bearing settings.
	updateBearingSettings();

	// Request the bearings from the client.
    $.ajax({
          url: "/get_bearings",
          dataType: 'json',
          async: true,
          success: function(data) {

			$.each(data, function(key, value) {
                addBearing(key, value, false);
            });
          }
    });

}


function bearingUpdate(data){
	// Remove any bearings that have been requested.
	removeBearings(data.remove);
	addBearing(data.add.key, data.add, true);
}


function toggleBearingsEnabled(){
	// Enable-disable bearing only mode, which hides the summary and telemetry displays

	// Grab the bearing-only-mode settings.
	var _bearings_enabled = getCheckboxState("bearingsEnabled", true);


	if ((_bearings_enabled == true) && (bearings_on == false)){
		// Show all bearings.
		redrawBearings();
		bearings_on = true;


	} else if ((_bearings_enabled == false) && (bearings_on == true)){
		// Hide all bearings, which we can do by re-drawing them - as the bearingsEnabled
		// button is not checked, re-drawing will remove all bearing lines from the map, and not re-add them.
		redrawBearings();

		// Hide the bearing plot
		$("#bearing_plot").hide();
		// Hide the bearing table
		$("#bearing_table").hide();

		bearings_on = false;

	}
}


function toggleBearingsOnlyMode(){
	// Enable-disable bearing only mode, which hides the summary and telemetry displays

	// Grab the bearing-only-mode settings.
	var bearingsOnlyModeElement = document.getElementById("bearingsOnlyMode");
	if (bearingsOnlyModeElement == null){
		return;
	}
	var _bearings_only_enabled = bearingsOnlyModeElement.checked;

	// Persist as a personal display preference (never sent to the server).
	if (typeof setLocalDisplaySetting === 'function'){
		setLocalDisplaySetting('bearings_only_mode', _bearings_only_enabled);
	}


	if ((_bearings_only_enabled == true) ){//} && (bearings_only_mode == false)){
		// The user had just enabled the bearings_only_mode, so hide things that are not relevant.
		
		$("#summary_table").hide();
		$("#telem_table_btn").hide();
		$("#telem_table").hide();
		$("#payload_age").hide();
		$("#pred_age").hide();

		bearings_only_mode = true;


	} else if ((_bearings_only_enabled == false)){//} && (bearings_only_mode == true)){
		// Un-hide balloon stuff

		$("#summary_table").show();
		$("#telem_table_btn").show();
		$("#telem_table").show();
		$("#payload_age").show();
		$("#pred_age").show();

		bearings_only_mode = false;

	}
}


function flushBearings(){
	// Send a message to the server to flush the bearing store, then clear our local bearing store.
    var _confirm = confirm("Really clear all Bearing data?");
    if (_confirm == true){
        socket.emit('bearing_store_clear', {data: 'plzkthx'});
		destroyAllBearings();
	}

}



function bearingPlotRender(angles, doa, data_valid){

	// Trying a colorblind-friendly color scheme.
	if(data_valid == true){
		_stroke_color = "#1A85FF";
	} else {
		_stroke_color = "#D41159";
	}

	if(getCheckboxState("bigTDOAEnabled", false)){
		_plot_dim = 400;
	}else{
		_plot_dim = 250;
	}

	if(dark_mode == true){
		_bg_color = "none";
	} else {
		_bg_color = "ghostwhite";
	}

	var _config = {
		"data": [{
			"t": angles,// [0,45,90,135,180,215,270,315], // theta values (x axis)
			"r": doa,//[-4,-3,-2,-1,0,-1,-2,-3,-4], // radial values (y axis)
			"name": "DOA", // name for the legend
			"visible": true,
			"color": _stroke_color, // color of data element
			"opacity": 1,
			"strokeColor": _stroke_color,
			"strokeDash": "solid", // solid, dot, dash (default)
			"strokeSize": 2,
			"visibleInLegend": false,
			"geometry": "AreaChart" // AreaChart, BarChart, DotPlot, LinePlot (default)
		}],
		"layout": {
			"height": _plot_dim, // (default: 450)
			"width": _plot_dim,
			"orientation":-90,
			"showlegend": false,
			"backgroundColor": _bg_color, // "ghostwhite",
			"radialAxis": {
				"domain": µ.DATAEXTENT,
				"visible": true
			},
			"margin": { 
				"top": 20,
				"right": 20,
				"bottom": 20,
				"left": 20
			},
		}};

    micropolar.Axis() // instantiate a new axis
  .config(_config) // configure it
  .render(d3.select('#bearing_plot'));
}

function toggle_bearing_plot_size(){
	if(bearing_large_plot == true){
		bearing_large_plot = false;
	}else{
		bearing_large_plot = true;
	}

	console.log(bearing_large_plot);
};

// TODO: This is not working
$("#bearing_plot").click(toggle_bearing_plot_size);

/**
	Returns the point that is a distance and heading away from
	the given origin point.
	@param {L.LatLng} latlng: origin point
	@param {float}: heading in degrees, clockwise from 0 degrees north.
	@param {float}: distance in meters
	@returns {L.latLng} the destination point.
	Many thanks to Chris Veness at http://www.movable-type.co.uk/scripts/latlong.html
	for a great reference and examples.

	Source: https://makinacorpus.github.io/Leaflet.GeometryUtil/leaflet.geometryutil.js.html#line712
*/
function calculateDestination(latlng, heading, distance) {
        heading = (heading + 360) % 360;
        var rad = Math.PI / 180,
            radInv = 180 / Math.PI,
            R = 6378137, // approximation of Earth's radius
            lon1 = latlng.lng * rad,
            lat1 = latlng.lat * rad,
            rheading = heading * rad,
            sinLat1 = Math.sin(lat1),
            cosLat1 = Math.cos(lat1),
            cosDistR = Math.cos(distance / R),
            sinDistR = Math.sin(distance / R),
            lat2 = Math.asin(sinLat1 * cosDistR + cosLat1 *
                sinDistR * Math.cos(rheading)),
            lon2 = lon1 + Math.atan2(Math.sin(rheading) * sinDistR *
                cosLat1, cosDistR - sinLat1 * Math.sin(lat2));
        lon2 = lon2 * radInv;
        lon2 = lon2 > 180 ? lon2 - 360 : lon2 < -180 ? lon2 + 360 : lon2;
        return L.latLng([lat2 * radInv, lon2]);
}


function calculateBearingOpacity(bearing_timestamp){
	if(bearing_timestamp > latest_server_timestamp){
		return bearing_max_opacity;
	}else if((latest_server_timestamp - bearing_timestamp) > bearing_max_age){
		return 0.0;
	}else{
		// Calculate an appropriate opacity.
		var _opacity = bearing_max_opacity -  (latest_server_timestamp - bearing_timestamp)/bearing_max_age;

		if (_opacity < bearing_min_opacity){
			_opacity = bearing_min_opacity;
		}
		return _opacity
	}

}


function manualBearing(){
	current_bearing = parseFloat($('#bearingManualEntry').val());

	_bearing_info = {
		'type': 'BEARING',
		'bearing_type': 'absolute',
		'source': 'EasyBearing',
		'latitude': chase_car_position.latest_data[0],
		'longitude': chase_car_position.latest_data[1],
		'bearing': current_bearing
	};
	// The server appends our name to 'source' (keeping the "EasyBearing"
	// prefix intact, since manual_bearing_sources above matches on it) so
	// bearings from different people are distinguishable on the map.
	if (typeof my_car_client_id !== 'undefined'){
		_bearing_info.client_id = my_car_client_id;
		_bearing_info.name = (typeof getMyCarName === 'function' && getMyCarName()) || undefined;
	}

	socket.emit('add_manual_bearing', _bearing_info);
}



function updateTimeSeqStatus(){
	// Update text indicating which sequence number is active.
	var _current_seq = getCurrentSeqNumber();
	if(_current_seq >= 0 ){
		var _timeseqtext = "Current Active: " + _current_seq + "<br>";
	} else {
		var _timeseqtext = "Current Active: None<br>";
	}
	for (var n=0; n<4; n++){
		if(timeSeqTimes[n] > 0){
			timeseq_hms = new Date(timeSeqTimes[n]);
			_timeseqtext += "Fox "+n+": " + timeseq_hms.toLocaleTimeString() + "<br>";
			$("#timeSeqSet" + n).css("background-color", "#00FF00");
		}else if (timeSeqTimes[n] < 0){
			_timeseqtext += "Fox "+n+": Not Set<br>";
			$("#timeSeqSet" + num).css("background-color", "#FF0000");
		} else {
			_timeseqtext += "Fox "+n+": Not Set<br>";
			$("#timeSeqSet" + n).css("background-color", "buttonface");
		}
	}

	$("#timeSeqStatus").html(_timeseqtext);
}

function updateTimeSeqClock(){
	if(timeSeqEnabled == true){
		var _current_seq = getCurrentSeqNumber();
		if( _current_seq >= 0 ){

			var _current_time = Date.now();
			var _seqtime = timeSeqActive - ((_current_time - timeSeqTimes[_current_seq]) % (timeSeqCycle*1000))/1000.0;

			$('#timeseq_notice').text("Fox " + _current_seq + ": " + _seqtime.toFixed(1));

		} else {
			$('#timeseq_notice').text("");
		}

	} else {
		$('#timeseq_notice').text("");
	}
}

function getCurrentSeqNumber(offset_seconds){
	// Determine the current transmitter number, based on current time and the timeSeqTimes.
	// Optional offset_seconds argument, to enable testing times slightly into the future.

	if (typeof offset_seconds === 'undefined') {
		offset_seconds = 0;
	}

	var _current_time = Date.now() + offset_seconds*1000;

	if(timeSeqTimes[0] > 0){
		if ((_current_time - timeSeqTimes[0]) % (timeSeqCycle*1000) < timeSeqActive*1000){
			return 0
		}
	}
	if(timeSeqTimes[1] > 0){
		if ((_current_time - timeSeqTimes[1]) % (timeSeqCycle*1000) < timeSeqActive*1000){
			return 1
		}
	}
	if(timeSeqTimes[2] > 0){
		if ((_current_time - timeSeqTimes[2]) % (timeSeqCycle*1000) < timeSeqActive*1000){
			return 2
		}
	}
	if(timeSeqTimes[3] > 0){
		if ((_current_time - timeSeqTimes[3]) % (timeSeqCycle*1000) < timeSeqActive*1000){
			return 3
		}
	}
	return -1;
}

function setTimeSeq(num){
	
	if (num>= 0){
		timeSeqEnabled = true;
		$("#timeSeqEnabled").prop('checked', true);
		// Check we arent currently in the middle of a transmit period
		if (getCurrentSeqNumber() < 0 && getCurrentSeqNumber(timeSeqActive)){
			// Update
			timeSeqTimes[num] = Date.now();
			// Set button color to green.
			$("#timeSeqSet" + num).css("background-color", "#00FF00");
		} else {
			timeSeqTimes[num] = -1;
			// Set button color to red.
			$("#timeSeqSet" + num).css("background-color", "#FF0000");
		}
	} else {
		timeSeqEnabled = false;
		$("#timeSeqEnabled").prop('checked', false);
		timeSeqTimes = [0,0,0,0];
		$("#timeSeqSet0").css("background-color", "buttonface");
		$("#timeSeqSet1").css("background-color", "buttonface");
		$("#timeSeqSet2").css("background-color", "buttonface");
		$("#timeSeqSet3").css("background-color", "buttonface");
	}
	updateTimeSeqStatus();
	clientSettingsUpdate();
}

function toggleTimeSeqEnabled(){
	// Enable-disable time sequenced transmitters.
	var _time_seq_enabled = getCheckboxState("timeSeqEnabled", false);

	if (_time_seq_enabled == true){
		// Enable time-sequenced transmitters.
		timeSeqEnabled = true;
	} else {
		// Disable time-sequenced transmitters.
		timeSeqEnabled = false;
	}
	clientSettingsUpdate();
}
