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

// How recent a bearing has to be to count as an "active source" in the DOA
// Bearing Panel (the compass card / legend / stat readout). Deliberately
// much shorter than bearing_max_age (which only governs how long a bearing
// *line* stays visible/fading on the map, default 10 minutes) - the panel is
// meant to read as "who's live right now", not a long history.
var doa_panel_stale_after_s = 120;
var doa_panel_max_sources = 6;
var doa_panel_expanded = false;

// Which of the DOA panel's three views (Readings / EasyBearing / O'Clock) is
// currently showing. All three live inside the one card (renderDoaPanel()),
// switched in place by a tab strip rather than navigating to /bearing or
// /oclock. doa_panel_built_tab/doa_panel_built_warning record what's actually
// in the DOM right now, so renderDoaPanel() can tell a "just redraw the
// compass, nothing else changed" call (new bearing arrived) apart from a
// "the panel needs to be rebuilt" one (tab switch, warning state flipped) -
// EasyBearing/O'Clock hold interaction state (a dial drag's pointer capture,
// mid-drag angle) in the DOM itself, which a wholesale innerHTML replace on
// every incoming bearing would otherwise clobber.
var doa_panel_active_tab = 'readings';
var doa_panel_built_tab = null;
var doa_panel_built_warning = false;

// EasyBearing tab: current (not-yet-sent) absolute bearing shown on the dial.
var doa_eb_bearing = 0;
var doa_eb_dragging = false;

// O'Clock tab: most recent relative bearing sent from this tab, for the
// "Last: 180° (6 o'clock) · 42s" readout.
var doa_oclock_last_value = null;
var doa_oclock_last_clock = null;
var doa_oclock_last_time = null;

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
		if (typeof removeBearingLineOnCesium === 'function') removeBearingLineOnCesium(key);
	});

	bearing_store = {};
	//bearing_sources = [];
	renderDoaPanel();
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
	var _end = calculateDestination([bearing_store[timestamp].lat, bearing_store[timestamp].lon], bearing_store[timestamp].true_bearing, bearing_length);

	var _opacity = calculateBearingOpacity(timestamp);

	var _is_manual_bearing = manual_bearing_sources.some(function (s) {
		return bearing.source.toLowerCase().includes(s.toLowerCase());
	});

	if(_is_manual_bearing){
		var _temp_bearing_weight = manual_bearing_weight;
	} else {
		var _temp_bearing_weight = bearing_weight;
	}

	_bearing_valid = bearingValid(bearing_store[timestamp]);
	if ( (_bearing_valid == true) && (getCheckboxState("bearingsEnabled", true) == true) ){
		if (typeof syncBearingLineOnCesium === 'function') {
			syncBearingLineOnCesium(timestamp, [[bearing_store[timestamp].lat, bearing_store[timestamp].lon], _end], getBearingLineColour(bearing_store[timestamp].source), _temp_bearing_weight, _opacity);
		}
	}

	if ( (live == true) && (getCheckboxState("bearingsEnabled", true) == true) ){

		if(_raw_bearing_angles.length > 0){
			if(getCheckboxState("tdoaEnabled", true) == true){
				_valid_tdoa = bearing_store[timestamp].confidence > bearing_confidence_threshold;
				bearingPlotRender(_raw_bearing_angles, _raw_doa, _valid_tdoa);
				$('#bearing_plot').show();
			}else{
				$('#bearing_plot').hide();
			}
		}
	}

	renderDoaPanel();
}


function removeBearings(timestamps){
	// Remove bearings from a supplied list
	timestamps.forEach(function (item, index){
		if(bearing_store.hasOwnProperty(item)){
			if (typeof removeBearingLineOnCesium === 'function') removeBearingLineOnCesium(item);
			delete bearing_store[item];
			console.log(item);
		}
	});

}


// Recomputes each bearing line's endpoint/colour/weight/opacity and
// upserts it on the map - used both to restyle in place as lines age
// (restyleBearings, e.g. opacity fading) and to fully redraw after a
// settings change (redrawBearings, e.g. bearing_length). Recomputing the
// endpoint is cheap trig, so there's no real cost to doing it in both cases.
function redrawBearings(){
	// Update the bearing settings.
	updateBearingSettings();

	$.each(bearing_store, function(key, value) {
		// Calculate the end position.
		var _end = calculateDestination([bearing_store[key].lat, bearing_store[key].lon], bearing_store[key].true_bearing, bearing_length);
		var _opacity = calculateBearingOpacity(key);

		var _is_manual_bearing = manual_bearing_sources.some(function (s) {
			return bearing_store[key].source.toLowerCase().includes(s.toLowerCase());
		});

		if(_is_manual_bearing){
			var _temp_bearing_weight = manual_bearing_weight;
		} else {
			var _temp_bearing_weight = bearing_weight;
		}

		if ( (bearingValid(bearing_store[key]) == true) && (getCheckboxState("bearingsEnabled", true) == true)){
			if (typeof syncBearingLineOnCesium === 'function') {
				syncBearingLineOnCesium(key, [[bearing_store[key].lat, bearing_store[key].lon], _end], getBearingLineColour(bearing_store[key].source), _temp_bearing_weight, _opacity);
			}
		} else {
			if (typeof removeBearingLineOnCesium === 'function') removeBearingLineOnCesium(key);
		}

	});
}

function restyleBearings(){
	redrawBearings();
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
		$("#doaBearingPanel").show();
		bearings_on = true;


	} else if ((_bearings_enabled == false) && (bearings_on == true)){
		// Hide all bearings, which we can do by re-drawing them - as the bearingsEnabled
		// button is not checked, re-drawing will remove all bearing lines from the map, and not re-add them.
		redrawBearings();

		// Hide the bearing plot
		$("#bearing_plot").hide();
		// Hide the DOA Bearing Panel
		$("#doaBearingPanel").hide();

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
	@param {[number,number]} latlng: origin point as [lat, lon]
	@param {float}: heading in degrees, clockwise from 0 degrees north.
	@param {float}: distance in meters
	@returns {[number,number]} the destination point as [lat, lon]
	Many thanks to Chris Veness at http://www.movable-type.co.uk/scripts/latlong.html
	for a great reference and examples.

	Source: https://makinacorpus.github.io/Leaflet.GeometryUtil/leaflet.geometryutil.js.html#line712
*/
function calculateDestination(latlng, heading, distance) {
        heading = (heading + 360) % 360;
        var rad = Math.PI / 180,
            radInv = 180 / Math.PI,
            R = 6378137, // approximation of Earth's radius
            lon1 = latlng[1] * rad,
            lat1 = latlng[0] * rad,
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
        return [lat2 * radInv, lon2];
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


// ---------------------------------------------------------------------------
// DOA Bearing Panel - the floating compass card (desktop) / collapsed pill +
// expanded sheet (mobile) showing the most recent bearing per active source.
// ---------------------------------------------------------------------------

function getActiveDoaSources(){
	// Latest bearing per source, restricted to sources heard from within
	// doa_panel_stale_after_s, newest-first, capped to doa_panel_max_sources.
	var _latest_by_source = {};
	$.each(bearing_store, function(timestamp, bearing){
		var _existing = _latest_by_source[bearing.source];
		if (!_existing || timestamp > _existing.timestamp){
			_latest_by_source[bearing.source] = {
				source: bearing.source,
				timestamp: parseFloat(timestamp),
				bearing: bearing.true_bearing,
				confidence: bearing.confidence,
				power: bearing.power,
				color: getBearingLineColour(bearing.source)
			};
		}
	});

	var _active = [];
	$.each(_latest_by_source, function(source, entry){
		if ((latest_server_timestamp - entry.timestamp) <= doa_panel_stale_after_s){
			_active.push(entry);
		}
	});

	_active.sort(function(a, b){ return b.timestamp - a.timestamp; });
	return _active.slice(0, doa_panel_max_sources);
}

function doaCompassPoint(cx, cy, radius, bearingDeg){
	var _rad = (bearingDeg || 0) * Math.PI / 180;
	return { x: cx + radius * Math.sin(_rad), y: cy - radius * Math.cos(_rad) };
}

function buildDoaCompassSvg(sources){
	var _cx = 130, _cy = 130;
	var _ringColor = sources.length ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.06)';
	var _labelColor = sources.length ? 'rgba(230,238,246,.4)' : 'rgba(230,238,246,.3)';
	var _crossColor = sources.length ? 'rgba(255,255,255,.06)' : 'rgba(255,255,255,.05)';

	var _svg = '<circle cx="' + _cx + '" cy="' + _cy + '" r="35" fill="none" stroke="' + _ringColor + '"></circle>';
	_svg += '<circle cx="' + _cx + '" cy="' + _cy + '" r="70" fill="none" stroke="' + _ringColor + '"></circle>';
	if (sources.length){
		_svg += '<circle cx="' + _cx + '" cy="' + _cy + '" r="100" fill="none" stroke="' + _ringColor + '"></circle>';
	} else {
		_svg += '<circle cx="' + _cx + '" cy="' + _cy + '" r="100" fill="none" stroke="rgba(255,255,255,.15)" stroke-dasharray="4 5"></circle>';
	}
	_svg += '<line x1="' + _cx + '" y1="30" x2="' + _cx + '" y2="230" stroke="' + _crossColor + '"></line>';
	_svg += '<line x1="30" y1="' + _cy + '" x2="230" y2="' + _cy + '" stroke="' + _crossColor + '"></line>';

	$.each(sources, function(i, entry){
		var _halfAngle = 8;
		var _edge1 = doaCompassPoint(_cx, _cy, 100, entry.bearing - _halfAngle);
		var _edge2 = doaCompassPoint(_cx, _cy, 100, entry.bearing + _halfAngle);
		var _tip = doaCompassPoint(_cx, _cy, 100, entry.bearing);
		_svg += '<path d="M' + _cx + ',' + _cy + ' L' + _edge1.x.toFixed(1) + ',' + _edge1.y.toFixed(1) +
			' A100,100 0 0 1 ' + _edge2.x.toFixed(1) + ',' + _edge2.y.toFixed(1) + ' Z" fill="' + entry.color + '" opacity="0.18"></path>';
		_svg += '<line x1="' + _cx + '" y1="' + _cy + '" x2="' + _tip.x.toFixed(1) + '" y2="' + _tip.y.toFixed(1) + '" stroke="' + entry.color + '" stroke-width="2"></line>';
		_svg += '<circle cx="' + _tip.x.toFixed(1) + '" cy="' + _tip.y.toFixed(1) + '" r="4" fill="' + entry.color + '"></circle>';
	});

	if (sources.length){
		_svg += '<circle cx="' + _cx + '" cy="' + _cy + '" r="2.5" fill="rgba(255,255,255,.3)"></circle>';
	}

	_svg += '<text x="' + _cx + '" y="20" text-anchor="middle" fill="' + _labelColor + '" class="mono" font-size="11">N</text>';
	_svg += '<text x="' + _cx + '" y="248" text-anchor="middle" fill="' + _labelColor + '" class="mono" font-size="11">S</text>';
	_svg += '<text x="242" y="134" text-anchor="middle" fill="' + _labelColor + '" class="mono" font-size="11">E</text>';
	_svg += '<text x="18" y="134" text-anchor="middle" fill="' + _labelColor + '" class="mono" font-size="11">W</text>';

	return '<svg class="doa-compass" width="180" height="180" viewBox="0 0 260 260">' + _svg + '</svg>';
}

var DOA_TABS = [
	{key: 'readings', label: 'Readings'},
	{key: 'easybearing', label: 'EasyBearing'},
	{key: 'oclock', label: "O'Clock"}
];

function buildDoaTabsHtml(){
	var _html = '<div class="doa-tab-row pill-toggle-group">';
	$.each(DOA_TABS, function(i, tab){
		_html += '<button type="button" class="pill-toggle-btn doa-tab-btn' + (doa_panel_active_tab === tab.key ? ' is-active' : '') + '" data-doa-tab="' + tab.key + '">' + tab.label + '</button>';
	});
	_html += '</div>';
	return _html;
}

// Header is shared by all three tabs (not just Readings, whose mockup card
// is the only one that shows it) because the mobile expanded-sheet close
// button lives here - dropping it on the other two tabs would leave no way
// to collapse the sheet while EasyBearing/O'Clock is open.
function buildDoaHeaderHtml(sources, titleOverride){
	var _countHtml = sources ? ('<span class="doa-panel-count mono">' + sources.length + ' SOURCE' + (sources.length === 1 ? '' : 'S') + '</span>') : '';
	return '<div class="doa-panel-header">' +
		'<span class="doa-panel-title">' + (titleOverride || 'DOA BEARING') + '</span>' +
		_countHtml +
		'<button type="button" class="doa-panel-close" aria-label="Close">&times;</button>' +
		'</div>';
}

function buildDoaReadingsBodyHtml(sources, hasSources, primary){
	var _legendHtml = '';
	if (hasSources){
		$.each(sources, function(i, entry){
			_legendHtml += '<div class="doa-legend-item">' +
				'<span class="doa-legend-dot" style="background:' + entry.color + '"></span>' +
				'<span class="doa-legend-label">' + escapeHtml(entry.source) + ' ' + Math.round(entry.bearing) + '&deg;</span>' +
				'<button type="button" class="doa-legend-clear" data-source="' + escapeHtml(entry.source) + '" aria-label="Clear bearings from ' + escapeHtml(entry.source) + '" title="Clear bearings from this source">&times;</button>' +
				'</div>';
		});
	}

	return '<div class="doa-panel-compass-wrap">' +
			buildDoaCompassSvg(sources) +
			(hasSources ? '' :
				'<div class="doa-panel-empty">' +
					'<div class="doa-panel-empty-title">No bearings yet</div>' +
					'<div class="doa-panel-empty-sub mono">Waiting for signal&hellip;</div>' +
				'</div>') +
		'</div>' +
		(hasSources ? '<div class="doa-panel-legend">' + _legendHtml + '</div>' : '') +
		'<div class="doa-panel-stats">' +
			'<div class="doa-stat"><div class="doa-stat-label">BRG</div><div class="doa-stat-value doa-stat-value--accent mono">' + (primary ? (Math.round(primary.bearing) + '&deg;') : '&mdash;') + '</div></div>' +
			'<div class="doa-stat"><div class="doa-stat-label">CONF</div><div class="doa-stat-value mono">' + (primary && typeof primary.confidence === 'number' ? (primary.confidence.toFixed(0) + '%') : '&mdash;') + '</div></div>' +
			'<div class="doa-stat"><div class="doa-stat-label">PWR</div><div class="doa-stat-value mono">' + (primary && typeof primary.power === 'number' ? (primary.power.toFixed(0) + 'dBm') : '&mdash;') + '</div></div>' +
		'</div>';
}

// Shared by the EasyBearing/O'Clock tabs: both submit via add_manual_bearing,
// which the server rejects without a known position (see 'bearing_rejected'
// / no_known_position in horusmapper.py's add_manual_bearing handler) -
// show this instead of the controls rather than letting a tap silently fail.
function buildDoaLocationWarningHtml(message){
	return '<div class="doa-warning">' +
		'<div class="doa-warning-box">' +
			'<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"></path><path d="M12 17h.01"></path><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path></svg>' +
			'<div>' +
				'<div class="doa-warning-title">Location sharing is off</div>' +
				'<div class="doa-warning-sub">' + (message || 'A bearing needs your position to be recorded. Enable sharing to continue.') + '</div>' +
			'</div>' +
		'</div>' +
		'<button type="button" id="doaEnableLocationBtn" class="doa-warning-btn">Enable Location Sharing</button>' +
		'</div>';
}

// EasyBearing submits an *absolute* bearing anchored at the tracked chase
// car's position (same source manualBearing() below already uses) - unlike
// the standalone /bearing page, that position can come from the car's own
// hardware GPS feed, not just this browser's device location, so the gate
// here is "do we know where the car is" rather than my_device_position_active.
// O'Clock submits a *relative* bearing, which the server fuses with the
// SUBMITTING BROWSER's own tracked position (add_manual_bearing in
// horusmapper.py) - that only exists once this browser is itself reporting
// its position, hence the different gate.
function doaTabNeedsLocationWarning(tab){
	if (tab === 'easybearing'){
		return (typeof chase_car_position === 'undefined') || chase_car_position.latest_data.length === 0;
	}
	if (tab === 'oclock'){
		return !((typeof my_device_position_active !== 'undefined') && my_device_position_active);
	}
	return false;
}

function doaFormatBearing(deg){
	var _d = Math.round(((deg % 360) + 360) % 360);
	return ('00' + _d).slice(-3) + '&deg;';
}

function doaFormatAge(timestampMs){
	var _secs = Math.round((Date.now() - timestampMs) / 1000);
	if (_secs < 60) return _secs + 's';
	return Math.round(_secs / 60) + 'm';
}

function updateDoaEbDialUI(){
	var _handle = document.getElementById('doaEbDialHandle');
	var _readout = document.getElementById('doaEbDialReadout');
	if (_handle) _handle.setAttribute('transform', 'rotate(' + doa_eb_bearing + ' 150 150)');
	if (_readout) _readout.innerHTML = doaFormatBearing(doa_eb_bearing);
}

function setDoaEbBearing(value){
	doa_eb_bearing = ((value % 360) + 360) % 360;
	updateDoaEbDialUI();
}

function doaEbAngleFromPointer(evt, svgEl){
	var _rect = svgEl.getBoundingClientRect();
	var _scale = 300 / _rect.width;
	var _x = (evt.clientX - _rect.left) * _scale;
	var _y = (evt.clientY - _rect.top) * _scale;
	var _deg = Math.atan2(_x - 150, -(_y - 150)) * 180 / Math.PI;
	return ((_deg % 360) + 360) % 360;
}

function sendDoaEasyBearing(){
	var _bearing_info = {
		'type': 'BEARING',
		'bearing_type': 'absolute',
		'source': 'EasyBearing',
		'latitude': chase_car_position.latest_data[0],
		'longitude': chase_car_position.latest_data[1],
		'bearing': doa_eb_bearing
	};
	if (typeof my_car_client_id !== 'undefined'){
		_bearing_info.client_id = my_car_client_id;
		_bearing_info.name = (typeof getMyCarName === 'function' && getMyCarName()) || undefined;
	}
	socket.emit('add_manual_bearing', _bearing_info);
	if (typeof showAppToast === 'function'){
		showAppToast('Bearing sent · ' + Math.round(doa_eb_bearing) + '°');
	}
}

function buildDoaEasyBearingHtml(){
	if (doaTabNeedsLocationWarning('easybearing')){
		return buildDoaLocationWarningHtml('EasyBearing needs a known chase car position before it can record a bearing.');
	}

	var _nudgeDeltas = [-10, -5, -1, 1, 5, 10];
	var _nudgeHtml = '';
	$.each(_nudgeDeltas, function(i, d){
		_nudgeHtml += '<button type="button" class="doa-eb-nudge-btn mono" data-delta="' + d + '">' + (d > 0 ? '+' : '−') + Math.abs(d) + '&deg;</button>';
	});

	return '<div class="doa-eb-wrap">' +
		'<div class="doa-eb-dial-wrap" id="doaEbDialWrap">' +
			'<svg id="doaEbDialSvg" class="doa-eb-dial-svg" viewBox="0 0 300 300">' +
				'<circle cx="150" cy="150" r="60" fill="none" stroke="rgba(255,255,255,.08)"></circle>' +
				'<circle cx="150" cy="150" r="100" fill="none" stroke="rgba(255,255,255,.08)"></circle>' +
				'<circle cx="150" cy="150" r="135" fill="none" stroke="rgba(255,255,255,.1)"></circle>' +
				'<line x1="150" y1="15" x2="150" y2="285" stroke="rgba(255,255,255,.06)"></line>' +
				'<line x1="15" y1="150" x2="285" y2="150" stroke="rgba(255,255,255,.06)"></line>' +
				'<g id="doaEbDialHandle" transform="rotate(' + doa_eb_bearing + ' 150 150)">' +
					'<line x1="150" y1="150" x2="150" y2="30" stroke="#FFCB05" stroke-width="3"></line>' +
					'<circle cx="150" cy="30" r="12" fill="#FFCB05" stroke="#0a0d16" stroke-width="3"></circle>' +
				'</g>' +
				'<circle cx="150" cy="150" r="4" fill="rgba(255,255,255,.4)"></circle>' +
				'<text x="150" y="32" text-anchor="middle" fill="rgba(230,238,246,.45)" class="mono" font-size="11">N</text>' +
				'<text x="150" y="270" text-anchor="middle" fill="rgba(230,238,246,.45)" class="mono" font-size="11">S</text>' +
				'<text x="266" y="154" text-anchor="middle" fill="rgba(230,238,246,.45)" class="mono" font-size="11">E</text>' +
				'<text x="32" y="154" text-anchor="middle" fill="rgba(230,238,246,.45)" class="mono" font-size="11">W</text>' +
			'</svg>' +
			'<div id="doaEbDialReadout" class="doa-eb-dial-readout mono">' + doaFormatBearing(doa_eb_bearing) + '</div>' +
		'</div>' +
		'<div class="doa-eb-nudge-row">' + _nudgeHtml + '</div>' +
		'<button type="button" id="doaEbSendBtn" class="doa-eb-send-btn">' +
			'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0a0d16" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>' +
			'Send Bearing' +
		'</button>' +
		'</div>';
}

function updateDoaOclockLastReadout(){
	if (doa_oclock_last_value === null) return;
	$('#doaOclockLastValue').text(doa_oclock_last_value + '° (' + doa_oclock_last_clock + " o'clock)");
	$('#doaOclockLastAge').text('· ' + doaFormatAge(doa_oclock_last_time));
	$('#doaOclockLast').show();
}

// Refreshes the two bits of the O'Clock tab that change purely with the
// passage of time (the Fox countdown, the "sent Ns ago" age) without
// rebuilding the tab - see the module doc comment on doa_panel_built_tab for
// why a wholesale rebuild is avoided here. Only forces a rebuild on the rare
// edge where the Fox chip itself needs to appear/disappear.
function updateDoaOclockDynamic(){
	var _currentSeq = (typeof getCurrentSeqNumber === 'function') ? getCurrentSeqNumber() : -1;
	var _chipShouldShow = timeSeqEnabled && _currentSeq >= 0;
	var $chip = $('#doaOclockFoxChip');

	if (_chipShouldShow !== ($chip.length > 0)){
		doa_panel_built_tab = null;
		renderDoaPanel();
		return;
	}

	if (_chipShouldShow){
		var _current_time = Date.now();
		var _seqtime = timeSeqActive - ((_current_time - timeSeqTimes[_currentSeq]) % (timeSeqCycle * 1000)) / 1000.0;
		$('#doaOclockFoxChipText').text('FOX ' + _currentSeq + ' · ' + _seqtime.toFixed(1) + 's');
	}

	updateDoaOclockLastReadout();
}

function buildDoaOclockHtml(){
	if (doaTabNeedsLocationWarning('oclock')){
		return buildDoaLocationWarningHtml();
	}

	var _foxHtml = '';
	var _currentSeq = (typeof getCurrentSeqNumber === 'function') ? getCurrentSeqNumber() : -1;
	if (timeSeqEnabled && _currentSeq >= 0){
		_foxHtml = '<div class="doa-oclock-fox-row"><div id="doaOclockFoxChip" class="doa-oclock-fox-chip mono">' +
			'<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="8"></circle><path d="M12 8v4l3 2"></path></svg>' +
			'<span id="doaOclockFoxChipText">FOX ' + _currentSeq + '</span>' +
			'</div></div>';
	}

	var _ringButtonsHtml = '';
	for (var i = 1; i <= 12; i++){
		var _bearing = (i % 12) * 30;
		var _rad = _bearing * Math.PI / 180;
		var _left = 50 + 43 * Math.sin(_rad);
		var _top = 50 - 43 * Math.cos(_rad);
		_ringButtonsHtml += '<button type="button" class="doa-oclock-btn mono' + (i === 12 ? ' doa-oclock-btn--twelve' : '') + '" style="left:' + _left + '%;top:' + _top + '%" data-bearing="' + _bearing + '" data-clock="' + i + '" aria-label="Signal at ' + i + " o'clock\">" + i + '</button>';
	}

	var _headingVal = (typeof chase_car_position !== 'undefined' && typeof chase_car_position.heading === 'number') ? (Math.round(chase_car_position.heading) + '&deg;') : '&mdash;';

	var _lastHtml = '<div id="doaOclockLast" class="doa-oclock-last mono"' + (doa_oclock_last_value === null ? ' style="display:none;"' : '') + '>' +
		'<span>Last:</span>' +
		'<span id="doaOclockLastValue" class="doa-oclock-last-value">' + (doa_oclock_last_value !== null ? (doa_oclock_last_value + '&deg; (' + doa_oclock_last_clock + " o'clock)") : '') + '</span>' +
		'<span id="doaOclockLastAge" class="doa-oclock-last-age"></span>' +
		'</div>';

	return '<div class="doa-oclock-wrap">' +
		_foxHtml +
		'<div class="doa-oclock-ring">' +
			'<svg class="doa-oclock-ring-svg" width="172" height="172" viewBox="0 0 400 400">' +
				'<circle cx="200" cy="200" r="178" fill="rgba(255,255,255,.03)" stroke="rgba(255,255,255,.1)"></circle>' +
				'<circle cx="200" cy="200" r="130" fill="none" stroke="rgba(255,255,255,.06)"></circle>' +
				'<line x1="200" y1="200" x2="200" y2="53" stroke="#6f9fd8" stroke-width="4"></line>' +
				'<polygon points="200,40 190,60 210,60" fill="#6f9fd8"></polygon>' +
				'<circle cx="200" cy="200" r="7" fill="#e6eef6"></circle>' +
			'</svg>' +
			_ringButtonsHtml +
			'<div class="doa-oclock-heading">' +
				'<div class="doa-oclock-heading-label mono">HDG</div>' +
				'<div id="doaOclockHeadingValue" class="doa-oclock-heading-value mono">' + _headingVal + '</div>' +
			'</div>' +
		'</div>' +
		_lastHtml +
		'</div>';
}

function renderDoaPanel(){
	var $panel = $('#doaBearingPanel');
	if ($panel.length === 0) return;

	var _sources = getActiveDoaSources();
	var _hasSources = _sources.length > 0;
	var _primary = _hasSources ? _sources[0] : null;

	// Keep the mobile collapsed pill's source count fresh regardless of which
	// tab is open, without touching the rest of the panel.
	$panel.find('.doa-panel-collapsed .doa-collapsed-count').text(_sources.length);

	if (doa_panel_built_tab === doa_panel_active_tab && doa_panel_active_tab !== 'readings'){
		// EasyBearing/O'Clock tab content doesn't depend on bearing_store, so
		// skip the wholesale DOM replace a bearing_change would otherwise
		// trigger here - see the doc comment on doa_panel_built_tab. Still
		// need to notice if the location-sharing warning state flips while
		// sitting on one of these tabs.
		var _warningNow = doaTabNeedsLocationWarning(doa_panel_active_tab);
		if (_warningNow === doa_panel_built_warning){
			$panel.toggleClass('doa-panel-empty-state', !_hasSources);
			return;
		}
		doa_panel_built_tab = null;
	}

	var _collapsedHtml = '<div class="doa-panel-collapsed">' +
		'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="7"></circle><line x1="12" y1="2" x2="12" y2="6"></line></svg>' +
		'<span class="mono">DOA &middot; <span class="doa-collapsed-count">' + _sources.length + '</span></span>' +
		'</div>';

	var _contentHtml;
	if (doa_panel_active_tab === 'easybearing'){
		_contentHtml = buildDoaHeaderHtml(null, 'EASYBEARING') + buildDoaEasyBearingHtml();
	} else if (doa_panel_active_tab === 'oclock'){
		_contentHtml = buildDoaHeaderHtml(null, "O'CLOCK") + buildDoaOclockHtml();
	} else {
		_contentHtml = buildDoaHeaderHtml(_sources) + buildDoaReadingsBodyHtml(_sources, _hasSources, _primary);
	}

	var _bodyHtml = '<div class="doa-panel-full">' + buildDoaTabsHtml() + _contentHtml + '</div>';

	doa_panel_built_tab = doa_panel_active_tab;
	doa_panel_built_warning = doaTabNeedsLocationWarning(doa_panel_active_tab);

	$panel.toggleClass('doa-panel-empty-state', !_hasSources);
	$panel.html('<div class="doa-panel-backdrop"></div>' + _collapsedHtml + _bodyHtml);
}

$(document).on('click', '.doa-tab-btn', function(e){
	e.stopPropagation();
	var _tab = $(this).attr('data-doa-tab');
	if (_tab === doa_panel_active_tab) return;
	doa_panel_active_tab = _tab;
	doa_panel_built_tab = null;
	renderDoaPanel();
});

$(document).on('click', '#doaEnableLocationBtn', function(e){
	e.stopPropagation();
	if (typeof startSharingMyLocation === 'function') startSharingMyLocation();
	doa_panel_built_tab = null;
	renderDoaPanel();
});

$(document).on('click', '.doa-eb-nudge-btn', function(e){
	e.stopPropagation();
	setDoaEbBearing(doa_eb_bearing + parseFloat($(this).attr('data-delta')));
});

$(document).on('click', '#doaEbSendBtn', function(e){
	e.stopPropagation();
	sendDoaEasyBearing();
});

// Drag-to-aim on the dial, delegated (rather than bound once at build time)
// so it keeps working across the targeted DOM updates above without needing
// to be re-attached - same reasoning as every other .doa-* handler here.
$(document).on('pointerdown', '#doaEbDialWrap', function(evt){
	doa_eb_dragging = true;
	var _native = evt.originalEvent;
	try { this.setPointerCapture(_native.pointerId); } catch(e){}
	setDoaEbBearing(doaEbAngleFromPointer(_native, document.getElementById('doaEbDialSvg')));
});
$(document).on('pointermove', '#doaEbDialWrap', function(evt){
	if (!doa_eb_dragging) return;
	setDoaEbBearing(doaEbAngleFromPointer(evt.originalEvent, document.getElementById('doaEbDialSvg')));
});
$(document).on('pointerup pointercancel', '#doaEbDialWrap', function(evt){
	if (!doa_eb_dragging) return;
	doa_eb_dragging = false;
	try { this.releasePointerCapture(evt.originalEvent.pointerId); } catch(e){}
});

$(document).on('click', '.doa-oclock-btn', function(e){
	e.stopPropagation();
	var $btn = $(this);
	$btn.addClass('is-flash');
	setTimeout(function(){ $btn.removeClass('is-flash'); }, 200);

	var _bearing = parseInt($btn.attr('data-bearing'), 10);
	var _clockLabel = $btn.attr('data-clock');

	var _bearing_info = {
		'type': 'BEARING',
		'bearing_type': 'relative',
		'source': 'EasyBearing',
		'bearing': _bearing
	};
	if (typeof my_car_client_id !== 'undefined'){
		_bearing_info.client_id = my_car_client_id;
		_bearing_info.name = (typeof getMyCarName === 'function' && getMyCarName()) || undefined;
	}
	socket.emit('add_manual_bearing', _bearing_info);

	doa_oclock_last_value = _bearing;
	doa_oclock_last_clock = _clockLabel;
	doa_oclock_last_time = Date.now();
	updateDoaOclockLastReadout();
});

// Refresh the O'Clock tab's Fox countdown / "sent Ns ago" readout every
// second while it's the active tab, same cadence as the standalone
// /oclock page's own refreshLastBearingAge interval.
setInterval(function(){
	if (doa_panel_active_tab === 'oclock'){
		updateDoaOclockDynamic();
	}
}, 1000);

$(document).on('click', '.doa-panel-collapsed', function(){
	doa_panel_expanded = true;
	$('#doaBearingPanel').addClass('doa-expanded');
});
$(document).on('click', '.doa-panel-close', function(){
	doa_panel_expanded = false;
	$('#doaBearingPanel').removeClass('doa-expanded');
});
$(document).on('click', '.doa-panel-backdrop', function(){
	doa_panel_expanded = false;
	$('#doaBearingPanel').removeClass('doa-expanded');
});

function clearBearingSource(source){
	// Server-authoritative: wait for the 'bearing_source_removed' broadcast
	// (see the socket.on handler in index.html) to actually drop the lines,
	// rather than deleting client-side here - same pattern as
	// server_bearings_cleared/destroyAllBearings for the full-clear case.
	socket.emit('bearing_source_clear', {source: source});
}

$(document).on('click', '.doa-legend-clear', function(e){
	// Stop propagation - the legend sits inside .doa-panel-full, which on
	// mobile is itself inside the expanded panel; a stray bubble up to
	// .doa-panel-backdrop/.doa-panel-collapsed would collapse the panel.
	e.stopPropagation();
	var _source = $(this).attr('data-source');
	if (!_source) return;

	if (typeof showDestructiveConfirmModal === 'function'){
		showDestructiveConfirmModal(
			'Clear Bearings',
			"Really clear all bearing data from '" + _source + "'?",
			'Clear',
			function(){ clearBearingSource(_source); }
		);
	} else if (confirm("Really clear all bearing data from '" + _source + "'?")){
		clearBearingSource(_source);
	}
});

// Age the panel out to its empty state / refresh "how recent" styling even
// when no new bearings are arriving.
setInterval(function(){ renderDoaPanel(); }, 5000);


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
