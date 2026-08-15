//
//   Project Horus - Browser-Based Chase Mapper - Car Position
//
//   Copyright (C) 2019  Mark Jessop <vk5qi@rfhead.net>
//   Released under GNU GPL v3 or later
//

var range_rings = [];
var range_rings_on = false;


function destroyRangeRings(){
	// Remove each range ring from the map.
	range_rings.forEach(function(element){
		element.remove();
	});
	// Clear the range ring array.
	range_rings = [];
	range_rings_on = false;
}


function createRangeRings(position){
	var _ring_quantity = parseInt($('#ringQuantity').val());
	var _ring_weight = parseFloat($('#ringWeight').val());
	var _ring_spacing = parseFloat($('#ringSpacing').val());
	var _ring_color = $('#ringColorSelect').val();
	var _ring_custom_color = $('#ringCustomColor').val();

	var _radius = _ring_spacing;
	var _color = "#FF0000";
        if (chase_config['unitselection'] == "imperial") { _radius = _ring_spacing*0.3048;}

	if(_ring_color == "red"){
		_color = "#FF0000";
	} else if (_ring_color == "black"){
		_color = "#000000";
	} else if (_ring_color == "blue"){
		_color = "#0000FF";
	} else if (_ring_color == "green"){
		_color = "#00FF00";
	} else if (_ring_color == "custom"){
		_color = _ring_custom_color;
	}

	for(var i=0; i<_ring_quantity; i++){
		var _ring = L.circle(position, {
			fill: false,
			color: _color,
			radius: _radius,
			weight: _ring_weight,
			opacity: 0.7
		}).addTo(map);
		range_rings.push(_ring);
                if (chase_config['unitselection'] == "metric")   { _radius += _ring_spacing;}
                if (chase_config['unitselection'] == "imperial") { _radius += _ring_spacing*0.3048;}
	}

	range_rings_on = true;

}


function recenterRangeRings(position){

	if ((getCheckboxState("rangeRingsEnabled", false) == true) && (range_rings_on == false)){
		// We have rings enabled, but haven't been able to create them yet.
		// Create them.
		updateRangeRings();
		return;
	} else {
		// Otherwise, just update the centre position of each ring.
		range_rings.forEach(function(element){
			element.setLatLng(position);
		});
	}
}


function updateRangeRings(){

	// Grab the range ring settings.
	var _ring_enabled = getCheckboxState("rangeRingsEnabled", false);

	// Persist as personal display preferences (never sent to the server).
	if (typeof setLocalDisplaySetting === 'function'){
		setLocalDisplaySetting('range_rings_enabled', _ring_enabled);
		var _rq = parseInt($('#ringQuantity').val());
		if (!isNaN(_rq)) setLocalDisplaySetting('range_ring_quantity', _rq);
		var _rs = parseFloat($('#ringSpacing').val());
		if (!isNaN(_rs)) setLocalDisplaySetting('range_ring_spacing', _rs);
		var _rw = parseFloat($('#ringWeight').val());
		if (!isNaN(_rw)) setLocalDisplaySetting('range_ring_weight', _rw);
		var _rc = $('#ringColorSelect').val();
		if (_rc) setLocalDisplaySetting('range_ring_color', _rc);
		var _rcc = $('#ringCustomColor').val();
		if (_rcc) setLocalDisplaySetting('range_ring_custom_color', _rcc);
	}

	// Check if we actually have a chase car position to work with.
	var _position = chase_car_position.latest_data;

	if (_position.length == 0){
		// No position available yet. Don't do anything.
		return;
	}
	// Otherwise, it looks like we have a position.

	if ((_ring_enabled == true) && (range_rings_on == false)){
		// The user had just enabled the range rings, so we need to create them.
		createRangeRings(_position);


	} else if ((_ring_enabled == false) && (range_rings_on == true)){
		// The user has disabled the range rings, so we remove them from the map.
		destroyRangeRings();

	} else {
		// Some other parameter has been changed.
		// Destroy, then re-create the range rings.
		destroyRangeRings();
		createRangeRings(_position);

	}

}

var reconfigureCarMarker = function(profile_name){
	// Remove chase-car marker if it exists, and is not used.
	if( (chase_config.profiles[profile_name].car_source_type === "none") || (chase_config.profiles[profile_name].car_source_type === "station")){
		if (chase_car_position.marker !== "NONE"){
			chase_car_position.marker.remove();
			chase_car_position.path.remove();
		}
	}

	if (chase_config.profiles[profile_name].car_source_type === "station") {
		// If we are using a stationary profile, add the station icon to the map.
		// Add our station location marker.
		home_marker = L.marker([chase_config.default_lat, chase_config.default_lon, chase_config.default_alt],
			{title: 'Receiver Location', icon: homeIcon}
			).addTo(map);
	}

	// If we are switching to a profile with a live car position source, remove the home station Icon
	if ((chase_config.profiles[profile_name].car_source_type === "serial") || (chase_config.profiles[profile_name].car_source_type === "gpsd") || (chase_config.profiles[profile_name].car_source_type === "horus_udp")){
		if(home_marker !== "NONE"){
			home_marker.remove();
		}
	}
}


//
// Multi-user chase-car identity.
//
// Each browser gets a persistent random id (stored in localStorage) plus an
// optional display name/callsign. When "Share My Location" is enabled, this
// id is sent along with every position update so the server tracks it as an
// independent chase car rather than overwriting anyone else's position.
//

var my_device_position_active = false;

function getMyCarClientId(){
	try{
		var _id = localStorage.getItem('chasemapper_client_id');
		if (!_id){
			_id = (window.crypto && typeof crypto.randomUUID === 'function') ?
				crypto.randomUUID() :
				('car-' + Math.random().toString(36).slice(2) + Date.now().toString(36));
			localStorage.setItem('chasemapper_client_id', _id);
		}
		return _id;
	}catch(e){
		// localStorage unavailable (e.g. private browsing) - fall back to a session-only id.
		if (!window._chasemapper_session_client_id){
			window._chasemapper_session_client_id = 'car-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
		}
		return window._chasemapper_session_client_id;
	}
}

var my_car_client_id = getMyCarClientId();

function getMyCarName(){
	try{
		return localStorage.getItem('chasemapper_car_name') || '';
	}catch(e){
		return '';
	}
}

function setMyCarName(name){
	try{
		localStorage.setItem('chasemapper_car_name', name);
	}catch(e){ /* ignore */ }
}

// Returns true if the supplied CAR telemetry event represents *this*
// browser's own position, rather than another connected chaser (or the
// primary/hardware-fed car, if this browser isn't sharing its own location).
function isMyOwnCarTelemetry(data){
	if (data.car_id){
		return data.car_id === my_car_client_id;
	}
	// No car_id => the primary/hardware-fed car. Only treat it as "mine"
	// if we aren't separately reporting our own device location.
	return !my_device_position_active;
}

var devicePositionCallback = function(position){
	// Pass a Device position update onto the back-end for processing and re-distribution.
	my_device_position_active = true;
	var device_pos = {
		time: position.timestamp,
		latitude: position.coords.latitude,
		longitude: position.coords.longitude,
		altitude: position.coords.altitude,
		client_id: my_car_client_id,
		name: getMyCarName() || undefined
	};
	socket.emit('device_position', device_pos);
}

var my_device_watch_id = null;

function startSharingMyLocation(){
	if (!(navigator && navigator.geolocation)){
		return false;
	}
	if (my_device_watch_id !== null){
		return true;
	}
	my_device_watch_id = navigator.geolocation.watchPosition(
		devicePositionCallback,
		devicePositionError,
		{enableHighAccuracy: true, maximumAge: 2000, timeout: 15000}
	);
	try{ localStorage.setItem('chasemapper_share_location', '1'); }catch(e){}
	return true;
}

function stopSharingMyLocation(){
	if (my_device_watch_id !== null){
		navigator.geolocation.clearWatch(my_device_watch_id);
		my_device_watch_id = null;
	}
	my_device_position_active = false;
	try{ localStorage.setItem('chasemapper_share_location', '0'); }catch(e){}
}

// Mobile browsers can throttle or fully suspend an active watchPosition() call
// while the tab is backgrounded (screen locked, user switches to a nav app) -
// with no event telling the app it happened. There's nothing to detect that
// *during* the background period, but on resume we can defensively restart the
// watch so a suspended one can't leave "Share My Location" silently stalled
// for the rest of the chase.
if (typeof document !== 'undefined' && document.addEventListener){
	document.addEventListener('visibilitychange', function(){
		if (document.visibilityState === 'visible' && my_device_watch_id !== null){
			navigator.geolocation.clearWatch(my_device_watch_id);
			my_device_watch_id = navigator.geolocation.watchPosition(
				devicePositionCallback,
				devicePositionError,
				{enableHighAccuracy: true, maximumAge: 2000, timeout: 15000}
			);
		}
	});
}

function clearMyCarTrack(){
	socket.emit('client_car_clear', {client_id: my_car_client_id});
}

var devicePositionError = function(error){
	console.log(error.message);
}

//
// Rendering of other connected chasers' live positions.
//
// Reuses the same chase_vehicles store / colour-cycled car icons already
// used for Habitat/SondeHub-sourced vehicles (see habitat.js / sondehub.js),
// keyed with a "LIVE:" prefix so it can't collide with a real callsign.
//

function shouldShowLiveChasers(){
	var el = document.getElementById('showLiveChasers');
	// Default to showing them if the control isn't present in the UI.
	return el == null || el.checked;
}

function handleOtherChaserTelemetry(data){
	if (!Array.isArray(data.position) || data.position.length < 2){
		return;
	}

	var _id = data.car_id || 'server';
	var _name = data.car_name || (_id === 'server' ? 'Base Station' : _id);
	var _key = 'LIVE:' + _id;
	var _latest_data = data.position;

	if (!chase_vehicles.hasOwnProperty(_key)){
		chase_vehicles[_key] = {};
		chase_vehicles[_key].heading = data.heading || 90;
		chase_vehicles[_key].latest_data = _latest_data;
		chase_vehicles[_key].name = _name;
		chase_vehicles[_key].colour = car_colour_values[car_colour_idx];
		car_colour_idx = (car_colour_idx + 1) % car_colour_values.length;

		chase_vehicles[_key].marker = L.marker(_latest_data, {
			title: _name,
			icon: habitat_car_icons[chase_vehicles[_key].colour],
			rotationOrigin: "center center"
		});
		// _name is free-text (another chaser's own chosen display name) and
		// Leaflet's bindTooltip renders string content as raw HTML, not
		// text - escape it so it can't inject markup/scripts into everyone
		// else's browser.
		chase_vehicles[_key].marker.bindTooltip(escapeHtml(_name), {
			permanent: true,
			direction: 'center',
			offset: [0, 25],
			className: 'custom_label'
		}).openTooltip();

		chase_vehicles[_key].onmap = false;
		if (shouldShowLiveChasers()){
			chase_vehicles[_key].marker.addTo(map);
			chase_vehicles[_key].onmap = true;
		}
	} else {
		chase_vehicles[_key].heading = (typeof data.heading === 'number') ? data.heading : chase_vehicles[_key].heading;
		chase_vehicles[_key].latest_data = _latest_data;
		if (chase_vehicles[_key].name !== _name){
			chase_vehicles[_key].name = _name;
			chase_vehicles[_key].marker.setTooltipContent(escapeHtml(_name));
		}
		chase_vehicles[_key].marker.setLatLng(_latest_data).update();
	}

	// Shares the pruneStaleChaseVehicles() sweep (see sondehub.js) with
	// SondeHub/Habitat-sourced vehicles - there is otherwise no signal at all
	// telling this browser when another chaser disconnects, so without this
	// their marker would stay on the map forever.
	chase_vehicles[_key].last_seen = Date.now();

	var _car_heading = chase_vehicles[_key].heading - 90.0;
	if (_car_heading <= 90.0){
		chase_vehicles[_key].marker.setIcon(habitat_car_icons[chase_vehicles[_key].colour]);
		chase_vehicles[_key].marker.setRotationAngle(_car_heading);
	} else {
		_car_heading = _car_heading - 180.0;
		chase_vehicles[_key].marker.setIcon(habitat_car_icons_flipped[chase_vehicles[_key].colour]);
		chase_vehicles[_key].marker.setRotationAngle(_car_heading);
	}

	if (typeof window.syncCesiumAfterOtherCarUpdate === 'function'){
		window.syncCesiumAfterOtherCarUpdate(_key, _name, chase_vehicles[_key]);
	}

	if (typeof updateChaserRosterDisplay === 'function'){
		updateChaserRosterDisplay();
	}
}

//
// Presence: connected count + a roster of who's actively sharing a
// position (this browser's own car plus every "LIVE:" entry in
// chase_vehicles). Purely a display convenience - doesn't affect routing,
// predictions, or any other multi-user logic above.
//

var car_colour_hex = {red: '#e74c3c', green: '#2ecc71', yellow: '#f1c40f', blue: '#3498db'};

function updateChaserCountDisplay(count){
	var el = document.getElementById('chaserCountLabel');
	if (!el){
		return;
	}
	el.textContent = count + (count === 1 ? ' connected' : ' connected');
}

function updateChaserRosterDisplay(){
	var _list = document.getElementById('chaserRoster');
	if (!_list){
		return;
	}

	var _entries = [];

	// My own car, if we have a position yet.
	if (chase_car_position && Array.isArray(chase_car_position.latest_data) && chase_car_position.latest_data.length > 0){
		_entries.push({name: (getMyCarName() || 'Me') + ' (you)', colour: 'blue'});
	}

	for (var _key in chase_vehicles){
		if (_key.indexOf('LIVE:') !== 0){
			continue;
		}
		_entries.push({name: chase_vehicles[_key].name || _key, colour: chase_vehicles[_key].colour || 'green'});
	}

	if (_entries.length === 0){
		_list.innerHTML = '<li class="chaser-roster-empty">No one sharing a location yet.</li>';
		return;
	}

	_list.innerHTML = _entries.map(function(_entry){
		var _hex = car_colour_hex[_entry.colour] || '#999';
		return '<li><span class="chaser-roster-swatch" style="background:' + _hex + ';"></span>' +
			'<span>' + $('<div>').text(_entry.name).html() + '</span></li>';
	}).join('');
}

// Show/hide every live-chaser marker currently known, without disconnecting
// anything (mirrors show_sondehub_vehicles() in sondehub.js).
function showLiveChasers(){
	var _state = shouldShowLiveChasers();
	for (var _car in chase_vehicles){
		if (_car.indexOf('LIVE:') !== 0){
			continue;
		}
		if (_state){
			if (!chase_vehicles[_car].onmap){
				chase_vehicles[_car].marker.addTo(map);
				chase_vehicles[_car].onmap = true;
			}
		} else {
			if (chase_vehicles[_car].onmap){
				chase_vehicles[_car].marker.remove();
				chase_vehicles[_car].onmap = false;
			}
		}
	}
}