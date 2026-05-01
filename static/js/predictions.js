//
//   Project Horus - Browser-Based Chase Mapper - Prediction Path Handlers
//
//   Copyright (C) 2019  Mark Jessop <vk5qi@rfhead.net>
//   Released under GNU GPL v3 or later
//

function queuePendingPrediction(data) {
    if (typeof pending_prediction_updates === 'undefined'){
        pending_prediction_updates = {};
    }
    pending_prediction_updates[data.callsign] = data;
}

function clearPendingPrediction(callsign) {
    if (typeof pending_prediction_updates !== 'undefined' && pending_prediction_updates.hasOwnProperty(callsign)){
        delete pending_prediction_updates[callsign];
    }
}

function ensurePredictionPathLayer(callsign) {
    if (!balloon_positions.hasOwnProperty(callsign)) {
        return null;
    }

    if (!balloon_positions[callsign].pred_path) {
        balloon_positions[callsign].pred_path = L.polyline([], {
            title: callsign + ' Prediction',
            color: balloon_positions[callsign].colour,
            opacity: prediction_opacity
        });
    }

    return balloon_positions[callsign].pred_path;
}

function setPredictionLandingMarker(callsign, predLanding) {
    predLanding = validMapPoint(predLanding) ? normalizeMapPoint(predLanding) : [];
    if (predLanding.length == 3){
        var landingText = callsign + " Landing " + predLanding[0].toFixed(5) + ", " + predLanding[1].toFixed(5);
        if (balloon_positions[callsign].pred_marker == null){
            balloon_positions[callsign].pred_marker = L.marker(predLanding,{title:callsign + " Landing", icon: balloonLandingIcons[balloon_positions[callsign].colour]})
                .bindTooltip(landingText ,{permanent:false,direction:'right'});
            if (balloon_positions[callsign].visible == true){
                balloon_positions[callsign].pred_marker.addTo(map);
                balloon_positions[callsign].pred_marker.on('click', function(e) {
                    var landingPosText = e.latlng.lat.toFixed(5) + ", " + e.latlng.lng.toFixed(5);
                    textToClipboard(landingPosText);
                });
            }
        }else{
            balloon_positions[callsign].pred_marker.setLatLng(predLanding);
            balloon_positions[callsign].pred_marker.setTooltipContent(landingText);
        }
        return;
    }

    if (balloon_positions[callsign].pred_marker != null){
        balloon_positions[callsign].pred_marker.remove();
        balloon_positions[callsign].pred_marker = null;
    }
}

function handlePrediction(data){
    // We expect the fields: callsign, pred_path, pred_landing, and abort_path and abort_landing, if abort predictions are enabled.
    var _callsign = (data.callsign || '').toString().toUpperCase();
    var _pred_path = normalizeMapPointList(data.pred_path);
    var _pred_landing = validMapPoint(data.pred_landing) ? normalizeMapPoint(data.pred_landing) : [];
    var _burst = validMapPoint(data.burst) ? normalizeMapPoint(data.burst) : [];
    var _abort_path = normalizeMapPointList(data.abort_path);
    var _abort_landing = validMapPoint(data.abort_landing) ? normalizeMapPoint(data.abort_landing) : [];

    console.log('handlePrediction called for', _callsign, '- pred_path points:', _pred_path.length, '- burst:', _burst, '- pred_landing:', _pred_landing);

    if (!_callsign) {
        return;
    }

    data.callsign = _callsign;

    if (balloon_positions.hasOwnProperty(_callsign) == false){
        queuePendingPrediction(data);
        return;
    }

    if (_pred_path.length === 0 && _pred_landing.length === 3) {
        var latest = balloon_positions[_callsign].latest_data;
        if (latest && validMapPoint(latest.position)) {
            _pred_path = [normalizeMapPoint(latest.position), _pred_landing];
        }
    }

    clearPendingPrediction(_callsign);

    // Add the landing marker if it doesnt exist.
    setPredictionLandingMarker(_callsign, _pred_landing);
    if(_burst.length == 3){
        // There is burst data!
        var _burst_txt = _callsign + " Burst (" + _burst[2].toFixed(0) + "m)";
        if (balloon_positions[_callsign].burst_marker == null){
            balloon_positions[_callsign].burst_marker = L.marker(_burst,{title:_burst_txt, icon: burstIcon})
                .bindTooltip(_burst_txt,{permanent:false,direction:'right'});

            if (balloon_positions[_callsign].visible == true){
                balloon_positions[_callsign].burst_marker.addTo(map);
            }
        }else{
            balloon_positions[_callsign].burst_marker.setLatLng(_burst);
            balloon_positions[_callsign].burst_marker.setTooltipContent(_burst_txt);
        }
    }else{
        // No burst data, or we are in descent.
        if (balloon_positions[_callsign].burst_marker != null){
            // Remove the burst icon from the map.
            balloon_positions[_callsign].burst_marker.remove();
            balloon_positions[_callsign].burst_marker = null;
        }
    }
    // Update the predicted path and ensure it is visible even when no landing marker is present.
    var predPathLayer = ensurePredictionPathLayer(_callsign);
    if (predPathLayer) {
        predPathLayer.setLatLngs(_pred_path);
        if (balloon_positions[_callsign].visible === true && !map.hasLayer(predPathLayer)) {
            predPathLayer.addTo(map);
        }
    }

    if (_abort_landing.length == 3){
        // Only update the abort data if there is actually abort data to show.
        if (balloon_positions[_callsign].abort_marker == null){
            balloon_positions[_callsign].abort_marker = L.marker(_abort_landing,{title:_callsign + " Abort", icon: abortIcon})
            .bindTooltip(_callsign + " Abort Landing",{permanent:false,direction:'right'});
            if((chase_config.show_abort == true) && (balloon_positions[_callsign].visible == true)){
                balloon_positions[_callsign].abort_marker.addTo(map);
            }
        }else{
            balloon_positions[_callsign].abort_marker.setLatLng(_abort_landing);
        }

        balloon_positions[_callsign].abort_path.setLatLngs(_abort_path);
    }else{
        // Clear out the abort and abort marker data.
        balloon_positions[_callsign].abort_path.setLatLngs([]);

        if (balloon_positions[_callsign].abort_marker != null){
            balloon_positions[_callsign].abort_marker.remove();
            balloon_positions[_callsign].abort_marker = null;
        }
    }
    // Reset the prediction data age counter.
    pred_data_age = 0.0;

    // Update the routing engine.
    // If the user is chasing this callsign, update the routing engine (if present).
    try{
        if ((typeof window !== 'undefined') && (window.balloon_currently_chased === data.callsign) && (typeof window.updateChaseRouteIfActive === 'function')){
            window.updateChaseRouteIfActive(data.callsign, data.pred_landing);
        }
    }catch(e){ /* ignore */ }
}

function flushPendingPrediction(callsign){
    if (typeof pending_prediction_updates === 'undefined'){
        return;
    }

    var _callsign = (callsign || '').toString();
    if (_callsign === ''){
        return;
    }

    if (pending_prediction_updates.hasOwnProperty(_callsign) == false){
        _callsign = _callsign.toUpperCase();
    }

    if (pending_prediction_updates.hasOwnProperty(_callsign) == true){
        var _pending = pending_prediction_updates[_callsign];
        delete pending_prediction_updates[_callsign];
        handlePrediction(_pending);
    }
}
