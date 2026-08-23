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

function ensurePredictionEntry(callsign) {
    // If we don't already have a balloon_positions entry, create a minimal
    // placeholder for callsigns that are in the APRS allowlist so predictions
    // can be rendered even before telemetry arrives.
    if (!balloon_positions.hasOwnProperty(callsign)) {
        try{
            var allowed = true;
            if (typeof chase_config !== 'undefined' && Array.isArray(chase_config.aprs_callsigns) && chase_config.aprs_callsigns.length > 0){
                allowed = chase_config.aprs_callsigns.some(function(x){ return (x||'').toString().toUpperCase() === callsign; });
            }
            if (!allowed) {
                return false;
            }
        }catch(e){
            return false;
        }

        // Create minimal entry so predictions can attach.
        balloon_positions[callsign] = {
            latest_data: null,
            age: 0,
            colour: colour_values[colour_idx],
            snr: -255.0,
            visible: true,
            path: [],
            pred_path: [],
            pred_marker: null,
            burst_marker: null,
            abort_path: [],
            abort_marker: null
        };
        colour_idx = (colour_idx+1)%colour_values.length;
    }

    if (!balloon_positions[callsign].pred_path) {
        balloon_positions[callsign].pred_path = [];
    }

    return true;
}

function setPredictionLandingMarker(callsign, predLanding) {
    predLanding = validMapPoint(predLanding) ? normalizeMapPoint(predLanding) : [];
    balloon_positions[callsign].pred_marker = (predLanding.length == 3) ? predLanding : null;
}

function buildCesiumPredictionSyncData(callsign, predPathData, predLandingData, burstData, abortPathData, abortLandingData) {
    var hasBalloon = balloon_positions.hasOwnProperty(callsign);
    var entry = hasBalloon ? balloon_positions[callsign] : null;

    return {
        telem: hasBalloon ? entry.latest_data : null,
        pathData: hasBalloon && entry.path ? entry.path : [],
        predPathData: predPathData,
        predLandingData: predLandingData.length === 3 ? predLandingData : null,
        burstData: burstData.length === 3 ? burstData : null,
        abortPathData: abortPathData,
        abortLandingData: abortLandingData.length === 3 ? abortLandingData : null,
        visible: hasBalloon ? entry.visible : true,
        colour: hasBalloon ? entry.colour : null
    };
}

function handlePrediction(data){
    // We expect the fields: callsign, pred_path, pred_landing, and abort_path and abort_landing, if abort predictions are enabled.
    var _callsign = (data.callsign || '').toString().toUpperCase();
    var _pred_path = normalizeMapPointList(data.pred_path);
    var _pred_landing = validMapPoint(data.pred_landing) ? normalizeMapPoint(data.pred_landing) : [];
    var _burst = validMapPoint(data.burst) ? normalizeMapPoint(data.burst) : [];
    var _abort_path = normalizeMapPointList(data.abort_path);
    var _abort_landing = validMapPoint(data.abort_landing) ? normalizeMapPoint(data.abort_landing) : [];

    if (!_callsign) {
        return;
    }

    data.callsign = _callsign;

    if (typeof balloon_positions !== 'undefined' && balloon_positions.hasOwnProperty(_callsign)) {
        balloon_positions[_callsign].pred_age = Date.now();
    }

    if (typeof window !== 'undefined' && typeof window.cacheAprsPredictionMeta === 'function') {
        window.cacheAprsPredictionMeta({
            callsign: _callsign,
            pred_path: _pred_path,
            pred_landing: _pred_landing,
            burst: _burst,
            abort_landing: _abort_landing
        });
    }

    if (balloon_positions.hasOwnProperty(_callsign) == false){
        queuePendingPrediction(data);
        return;
    }

    balloon_positions[_callsign].pred_age = Date.now();

    if (_pred_path.length === 0 && _pred_landing.length === 3) {
        var latest = balloon_positions[_callsign].latest_data;
        if (latest && validMapPoint(latest.position)) {
            _pred_path = [normalizeMapPoint(latest.position), _pred_landing];
        }
    }

    clearPendingPrediction(_callsign);

    // Add the landing marker if it doesnt exist.
    setPredictionLandingMarker(_callsign, _pred_landing);

    balloon_positions[_callsign].burst_marker = (_burst.length == 3) ? _burst : null;

    // Update the predicted path.
    ensurePredictionEntry(_callsign);
    balloon_positions[_callsign].pred_path = _pred_path || [];

    if (_abort_landing.length == 3){
        balloon_positions[_callsign].abort_marker = _abort_landing;
        balloon_positions[_callsign].abort_path = _abort_path;
    }else{
        // Clear out the abort and abort marker data.
        balloon_positions[_callsign].abort_path = [];
        balloon_positions[_callsign].abort_marker = null;
    }
    // Reset the prediction data age counter.
    pred_data_age = 0.0;

    if (typeof updatePredictorDetailsPanel === 'function') {
        updatePredictorDetailsPanel(data);
    }

    // Update the routing engine.
    // If the user is chasing this callsign, update the routing engine (if present).
    try{
        if ((typeof window !== 'undefined') && (window.balloon_currently_chased === data.callsign) && (typeof window.updateChaseRouteIfActive === 'function')){
            window.updateChaseRouteIfActive(data.callsign, data.pred_landing);
            // Sync the position tracking for car movement detection
            if (typeof window.chase_car_position !== 'undefined' && window.chase_car_position.latest_data && window.chase_car_position.latest_data.length >= 2) {
                window.last_route_calc_position = [window.chase_car_position.latest_data[0], window.chase_car_position.latest_data[1]];
            }
        }
    }catch(e){ /* ignore */ }

    // buildCesiumPredictionSyncData copies the balloon's entire (unbounded) path -
    // skip it entirely when the 3D view isn't active to consume it.
    if (typeof syncCesiumAfterPredictionUpdate === 'function' && (typeof isCesiumActive !== 'function' || isCesiumActive())) {
        syncCesiumAfterPredictionUpdate(_callsign, buildCesiumPredictionSyncData(
            _callsign,
            _pred_path,
            _pred_landing,
            _burst,
            _abort_path,
            _abort_landing
        ));
    }
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
