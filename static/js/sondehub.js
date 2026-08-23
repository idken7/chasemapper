//
//   Project Horus - Browser-Based Chase Mapper - SondeHub Websockets Connection.
//
//   Copyright (C) 2022  Mark Jessop <vk5qi@rfhead.net>
//   Released under GNU GPL v3 or later
//


function handleSondeHubWebSocketPacket(data){
    // Handle a packet of vehicle / listener telemetry from a SondeHub / SondeHub-Amateur Websockets Connection.

    // Only process frames where the 'mobile' flag is present and is true.
    if (data.hasOwnProperty('mobile')){
        if(data['mobile'] == true){
            // We have found a mobile station!
            //console.log(data);

            // Extract position.
            var v_lat = parseFloat(data.uploader_position[0]);
            var v_lon = parseFloat(data.uploader_position[1]);
            var v_alt = parseFloat(data.uploader_position[2]);
            var vcallsign = data.uploader_callsign;
            
            // If the vehicle is already known to us, then update it position.
            // Update any existing entries (even if the range is above the threshold)
            if (chase_vehicles.hasOwnProperty(vcallsign)){
                //console.log("Updating: " + vcallsign);
                // Update the position ID.
                chase_vehicles[vcallsign].position_id = data.ts;
                chase_vehicles[vcallsign].last_seen = Date.now();

                // Since we don't always get a heading with the vehicle position, calculate it.
                var old_v_pos = {lat:chase_vehicles[vcallsign].latest_data[0],
                    lon: chase_vehicles[vcallsign].latest_data[1], 
                    alt:chase_vehicles[vcallsign].latest_data[2]};
                var new_v_pos = {lat: v_lat, lon:v_lon, alt:v_alt};
                chase_vehicles[vcallsign].heading = calculate_lookangles(old_v_pos, new_v_pos).azimuth;

                // Update the position data.
                chase_vehicles[vcallsign].latest_data = [v_lat, v_lon, v_alt];

                if (typeof window.syncCesiumAfterOtherCarUpdate === 'function'){
                    window.syncCesiumAfterOtherCarUpdate(vcallsign, vcallsign, chase_vehicles[vcallsign]);
                }

            } else {

                // Otherwise, we need to decide if we're going to add it or not.

                // Is it us?
                if(vcallsign.startsWith(chase_config.habitat_call)){
                    // Don't add!
                    return;
                }

                // Determine the vehicle distance from our current position.
                var v_pos = {lat: v_lat, lon:v_lon, alt:v_alt};
                if (!chase_car_position.active){
                    var my_pos = {lat:chase_config.default_lat, lon:chase_config.default_lon, alt:0};
                }else{
                    var my_pos = {lat:chase_car_position.latest_data[0], lon:chase_car_position.latest_data[1], alt:chase_car_position.latest_data[2]};
                }
                var v_range = calculate_lookangles(my_pos, v_pos).range/1000.0;

                // If the range is less than the threshold, add it to our list of chase vehicles.
                if(v_range < vehicle_max_range){
                    //console.log("Adding: " + vcallsign);
                    chase_vehicles[vcallsign] = {};
                    // Initialise a few default values
                    chase_vehicles[vcallsign].heading = 90;
                    chase_vehicles[vcallsign].latest_data = [v_lat, v_lon, v_alt];
                    chase_vehicles[vcallsign].position_id = data.ts;
                    chase_vehicles[vcallsign].last_seen = Date.now();

                    // Get an index for the car icon. This is incremented for each vehicle,
                    // giving each a different colour.
                    chase_vehicles[vcallsign].colour = car_colour_values[car_colour_idx];
                    car_colour_idx = (car_colour_idx+1)%car_colour_values.length;

                    chase_vehicles[vcallsign].onmap = shouldShowSondeHubVehicles();
                    if (typeof window.syncCesiumAfterOtherCarUpdate === 'function'){
                        window.syncCesiumAfterOtherCarUpdate(vcallsign, vcallsign, chase_vehicles[vcallsign]);
                    }

                }
            }
        }
    }
}

// Other chasers' markers (chase_vehicles, populated above and by the dormant
// habitat.js polling path) are only ever added/updated, never removed for
// staleness. A chaser who goes offline or drives out of range would otherwise
// stay shown on the map indefinitely - misleading during a live recovery, and
// an unbounded set of map objects over a many-hour flight. Sweep out anything
// that hasn't reported in a while.
var CHASE_VEHICLE_STALE_MS = 15 * 60 * 1000;

function pruneStaleChaseVehicles(){
    var _now = Date.now();
    $.each(chase_vehicles, function(vcallsign, vehicle){
        if (vehicle.last_seen && (_now - vehicle.last_seen) > CHASE_VEHICLE_STALE_MS){
            if (typeof window.removeOtherChaserEntity === 'function'){
                window.removeOtherChaserEntity(vcallsign);
            }
            delete chase_vehicles[vcallsign];
        }
    });
}

window.setInterval(pruneStaleChaseVehicles, 60000);


function flush_sondehub_vehicles(){
	for (_car in chase_vehicles){
        // Remove from map if present.
        if(chase_vehicles[_car].onmap){
            if (typeof window.removeOtherChaserEntity === 'function'){
                window.removeOtherChaserEntity(_car);
            }
            chase_vehicles[_car].onmap = false;
        }
        delete chase_vehicles[_car];
	}
}

//
// SondeHub Websockets connection.
//
var livedata = "wss://ws-reader.v2.sondehub.org/";
var clientID = "ChaseMapper-" + Math.floor(Math.random() * 10000000000);
var client; 
var clientConnected = false;
var clientActive = false;
var clientTopic;

function shouldShowSondeHubVehicles() {
    var showOtherCarsElement = document.getElementById("showOtherCars");
    return showOtherCarsElement != null && showOtherCarsElement.checked;
}

function onConnect() {
    if (chase_config.profiles[chase_config.selected_profile].online_tracker === "sondehub") {
        var topic = "listener/#";
        client.subscribe(topic);
        clientTopic = topic;
    } else if (chase_config.profiles[chase_config.selected_profile].online_tracker === "sondehubamateur") {
        var topic = "amateur-listener/#";
        client.subscribe(topic);
        clientTopic = topic;
    } else {
        return;
    }
    clientConnected = true;
    clientActive = true;
    console.log("SondeHub Websockets Connected - Subscribed to " + clientTopic);
};

function connectionError(error) {
    clientConnected = false;
    clientActive = false;
    console.log("SondeHub Websockets Connection Error");
};

function onConnectionLost(responseObject) {
    if (responseObject.errorCode !== 0) {
        clientConnected = false;
        clientActive = false;
        console.log("SondeHub Websockets Connection Lost");
    }
};

function onMessageArrived(message) {
    try {
        if (clientActive) {
            var frame = JSON.parse(message.payloadString.toString());
            handleSondeHubWebSocketPacket(frame);
        }
    }
    catch(err) {
        // Malformed frame or handler error - log at debug so it's discoverable
        // without spamming the console for every dropped/garbled packet.
        console.debug('SondeHub message parse/handle error', err);
    }
};

function startSondeHubWebsockets() {
    if(shouldShowSondeHubVehicles()){
        // Clear off any vehicles on the map.
        flush_sondehub_vehicles();

        if(clientConnected == false){
            // Not connected yet. Start a new connection.
            client = new Paho.Client(livedata, clientID);
            client.onConnectionLost = onConnectionLost;
            client.onMessageArrived = onMessageArrived;
            client.connect({onSuccess:onConnect,onFailure:connectionError,reconnect:true});
        } else {
            // Already connected, un-sub and re-sub to the correct topic.
            client.unsubscribe(clientTopic);
            onConnect();
        }
    } else {
        if(clientConnected || (client != null)){
            client.disconnect();
            clientConnected = false;
            console.log("SondeHub Websockets Disconnected.")
        }
    }
}


// Show/Hide all vehicles.
function show_sondehub_vehicles(){
	var state = shouldShowSondeHubVehicles();

	for (_car in chase_vehicles){
		chase_vehicles[_car].onmap = state;
		if (typeof window.syncCesiumAfterOtherCarUpdate === 'function'){
			window.syncCesiumAfterOtherCarUpdate(_car, chase_vehicles[_car].name, chase_vehicles[_car]);
		}
	}

    // Re-connect to websockets if necessary.
    startSondeHubWebsockets();
}






/* Habitat ChaseCar lib (copied from SondeHub Tracker)
 * Uploads geolocation for chase cars to habitat
 *
 * Author: Rossen Gerogiev / Mark Jessop
 * Requires: jQuery
 * 
 * Updated to SondeHub v2 by Mark Jessop
 */

ChaseCar = {
    db_uri: "https://api.v2.sondehub.org/listeners",   // Sondehub API
    recovery_uri: "https://api.v2.sondehub.org/recovered",
};

// Updated SondeHub position upload function.
// Refer PUT listeners API here: https://generator.swagger.io/?url=https://raw.githubusercontent.com/projecthorus/sondehub-infra/main/swagger.yaml
// @callsign string
// @position object (geolocation position object)
ChaseCar.updatePosition = function(callsign, position) {
    if(!position || !position.coords) return;

    // Set altitude to zero if not provided.
    _position_alt = ((!!position.coords.altitude) ? position.coords.altitude : 0);

    var _doc = {
        "software_name": "SondeHub Tracker",
        "software_version": "{VER}",
        "uploader_callsign": callsign,
        "uploader_position": [position.coords.latitude, position.coords.longitude, _position_alt],
        "uploader_antenna": "Mobile Station",
        "uploader_contact_email": "none@none.com",
        "mobile": true
    };

    // push the doc to sondehub
    $.ajax({
            type: "PUT",
            url: ChaseCar.db_uri,
            contentType: "application/json; charset=utf-8",
            dataType: "json",
            data: JSON.stringify(_doc),
    });
};


ChaseCar.markRecovered = function(serial, lat, lon, recovered, callsign, notes){

    var _doc = {
        "serial": serial,
        "lat": lat,
        "lon": lon,
        "alt": 0.0,
        "recovered": recovered,
        "recovered_by": callsign,
        "description": notes
    };

    $.ajax({
        type: "PUT",
        url: ChaseCar.recovery_uri,
        contentType: "application/json; charset=utf-8",
        dataType: "json",
        data: JSON.stringify(_doc),
    }).done(function(data) {
        console.log(data);
        alert("Recovery Reported OK!");
    })
    .fail(function(jqXHR, textStatus, error) {
        try {
            _fail_resp = JSON.parse(jqXHR.responseText);
            alert("Error Submitting Recovery Report: " + _fail_resp.message);
        } catch(err) {
            alert("Error Submitting Recovery Report.");
        }
    })

}
