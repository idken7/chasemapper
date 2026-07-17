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
    pred_model_time: '—',
    enable_3d_map_view: false,
    cesium_map_mode: 'standard',
    show_abort: true, // Show a prediction of an 'abort' paths (i.e. if the balloon bursts *now*)
    offline_tile_layers: [],
    habitat_call: 'N0CALL',
    aprs_prediction_overrides: {}
};

// APRS UI state cache keyed by uppercased callsign.
var aprs_telemetry_cache = {};
var aprs_last_rx_ms = {};
var aprs_refresh_pending = {};
var aprs_prediction_meta_cache = {};
var APRS_DETAIL_FIELDS = [
    {label: 'Alt', className: 'aprs-val-alt'},
    {label: 'Speed', className: 'aprs-val-speed'},
    {label: 'Ascent', className: 'aprs-val-ascent'},
    {label: 'Az', className: 'aprs-val-az'},
    {label: 'El', className: 'aprs-val-el'},
    {label: 'Range', className: 'aprs-val-range'}
];

// Cache for frequently accessed DOM elements to reduce selector overhead
var _aprsListCache = null;
var _aprsPredictionModalCache = null;
var _aprsStatusDotCache = null;

function getAprsListElement() {
    if (_aprsListCache === null) {
        _aprsListCache = $('#aprsList');
    }
    return _aprsListCache;
}

function getAprsPredictionModal() {
    if (_aprsPredictionModalCache === null) {
        _aprsPredictionModalCache = $('#aprsPredictionModal');
    }
    return _aprsPredictionModalCache;
}

function getAprsStatusDotElement() {
    if (_aprsStatusDotCache === null) {
        _aprsStatusDotCache = $('#aprsStatusDot');
    }
    return _aprsStatusDotCache;
}

function normalizeCallsign(value) {
    return (value || '').toString().toUpperCase();
}

function createAprsActionButton(htmlIcon, fallbackLabel, csKey, btnClass, testSuffix, title, ariaLabel) {
    return $('<button type="button">')
        .html(htmlIcon + '<span class="' + fallbackLabel + '">'
            + (fallbackLabel === 'aprs-follow-fallback' ? 'Follow' :
               fallbackLabel === 'aprs-refresh-fallback' ? 'Refresh' :
               fallbackLabel === 'aprs-recovery-fallback' ? 'Recover' :
               fallbackLabel === 'aprs-settings-fallback' ? 'Settings' :
               fallbackLabel === 'aprs-view-fallback' ? 'View' :
               fallbackLabel === 'aprs-remove-fallback' ? 'Del' : fallbackLabel) + '</span>')
        .addClass('btn btn-sm ' + btnClass)
        .data('callsign', csKey)
        .attr('title', title)
        .attr('aria-label', ariaLabel)
        .attr('data-test', 'aprs-' + testSuffix + '-' + csKey);
}

function getAprsStatusTimeoutMs() {
    return 60000;
}

function parseAprsPacketTimeMs(telem) {
    if (!telem) {
        return NaN;
    }

    var rawTime = telem.packet_time || telem.time_dt || telem.timestamp || null;
    if (!rawTime) {
        return NaN;
    }

    var ts = new Date(rawTime);
    if (isNaN(ts.getTime())) {
        return NaN;
    }

    return ts.getTime();
}

function setAprsStatusDot(state, titleText) {
    var dot = getAprsStatusDotElement();
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
        var key = normalizeCallsign(cs);
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
        setAprsStatusDot('connecting', 'APRS status: stale (no recent APRS data)');
    } else {
        setAprsStatusDot('broken', 'APRS status: broken (no APRS data yet)');
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

function getAprsTimezone() {
    var tz = (chase_config.aprs_timezone || 'local').toString().trim();
    if (tz === '' || tz.toLowerCase() === 'local') {
        return null;
    }

    try {
        new Intl.DateTimeFormat(undefined, {timeZone: tz});
        return tz;
    } catch (e) {
        return null;
    }
}

function populateTimezoneOptions() {
    var list = $('#timezoneOptions');
    if (list.length === 0 || list.children().length > 0) {
        return;
    }

    var zones = [];
    try {
        if (typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function') {
            zones = Intl.supportedValuesOf('timeZone');
        }
    } catch (e) {
        zones = [];
    }

    if (zones.length === 0) {
        zones = ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles'];
    }

    zones.slice(0, 200).forEach(function(tz) {
        list.append($('<option>').attr('value', tz));
    });
}

function createAprsDetailRow(label, valueClass) {
    var row = $('<div>').addClass('aprs-detail-row');
    row.append($('<span>').addClass('aprs-detail-label').text(label));
    row.append($('<span>').addClass('aprs-detail-value ' + valueClass).text('\u2014'));
    return row;
}

function createAprsDetailGrid() {
    var detailGrid = $('<div>').addClass('aprs-detail-grid mt-1');
    APRS_DETAIL_FIELDS.forEach(function(field) {
        detailGrid.append(createAprsDetailRow(field.label, field.className));
    });
    return detailGrid;
}

function getAprsPredictionOverrides() {
    if (!chase_config.aprs_prediction_overrides || typeof chase_config.aprs_prediction_overrides !== 'object') {
        chase_config.aprs_prediction_overrides = {};
    }
    if (typeof chase_config.cesium_map_mode !== 'string' || chase_config.cesium_map_mode.length === 0) {
        try {
            chase_config.cesium_map_mode = localStorage.getItem('chasemapper_cesium_map_mode') || 'standard';
        } catch (e) {
            chase_config.cesium_map_mode = 'standard';
        }
    }

    return chase_config.aprs_prediction_overrides;
}

function getAprsPredictionOverride(csKey) {
    var key = normalizeCallsign(csKey);
    if (!key) {
        return {};
    }

    var overrides = getAprsPredictionOverrides();
    var entry = overrides[key];
    if (!entry || typeof entry !== 'object') {
        return {};
    }

    return entry;
}

function normalizeAprsPredictionNumber(value, fallback) {
    var parsed = parseFloat(value);
    if (isNaN(parsed) || !isFinite(parsed)) {
        return fallback;
    }
    return parsed;
}

function setPredictorModelDisplay(model, modelTime) {
    $('#predictorModelValue').text(model || 'Disabled');
    if (typeof modelTime === 'string' && modelTime.length > 0) {
        $('#predictorModelTimeValue').text(modelTime);
    } else if (typeof modelTime !== 'undefined' && modelTime !== null) {
        $('#predictorModelTimeValue').text(String(modelTime));
    } else if (!$('#predictorModelTimeValue').text()) {
        $('#predictorModelTimeValue').text('—');
    }
}

function get3DMapViewEnabled() {
    try {
        var stored = localStorage.getItem('enable_3d_map_view');
        if (stored === '1' || stored === 'true') {
            return true;
        }
        if (stored === '0' || stored === 'false') {
            return false;
        }
    } catch (e) {
        // Ignore storage failures and fall through to config state.
    }

    if (typeof chase_config !== 'undefined' && chase_config.enable_3d_map_view === true) {
        return true;
    }

    return false;
}

function set3DMapViewEnabled(enabled, persistStorage) {
    var next = !!enabled;
    chase_config.enable_3d_map_view = next;

    if (persistStorage !== false) {
        try {
            localStorage.setItem('enable_3d_map_view', next ? '1' : '0');
        } catch (e) {
            // Ignore storage failures.
        }
    }

    return next;
}

function update3DButtonVisual() {
    var active = get3DMapViewEnabled();
    var button = $('#toggle3DButton');
    if (button.length === 0) {
        return;
    }

    button.toggleClass('is-active', active);
    button.find('a, button').toggleClass('is-active', active).attr('aria-pressed', active ? 'true' : 'false');
    button.attr('title', active ? 'Disable 3D view' : 'Enable 3D view');
}

function apply3DMapViewState() {
    var active = get3DMapViewEnabled();
    $('#map').toggleClass('map-3d-view', active);
    $('body').toggleClass('map-3d-view', active);
    if (typeof applyCesiumMapViewState === 'function') {
        applyCesiumMapViewState(active);
    }

    if (active && typeof window !== 'undefined' && typeof window.applyCesiumMapMode === 'function') {
        var selectedMode = null;
        try {
            selectedMode = localStorage.getItem('chasemapper_cesium_map_mode');
        } catch (e) {
            selectedMode = null;
        }
        window.applyCesiumMapMode(selectedMode || chase_config.cesium_map_mode || 'standard', {persist: false});
    }

    update3DButtonVisual();

    try {
        var $cesiumMode = $('#cesiumMapModeSelect');
        if ($cesiumMode && $cesiumMode.length) {
            $cesiumMode.prop('disabled', !active);
            $cesiumMode.attr('aria-disabled', !active);
        }
    } catch (e) {
        // ignore
    }
}

var _destructiveConfirmCallback = null;

function showDestructiveConfirmModal(title, message, confirmLabel, confirmCallback) {
    _destructiveConfirmCallback = typeof confirmCallback === 'function' ? confirmCallback : null;
    $('#destructiveConfirmModalTitle').text(title || 'Confirm Action');
    $('#destructiveConfirmModalMessage').text(message || 'Are you sure?');
    $('#destructiveConfirmModalSubmitBtn').text(confirmLabel || 'Confirm');

    var $modal = $('#destructiveConfirmModal');
    $modal.addClass('is-open').attr('aria-hidden', 'false');
    window.requestAnimationFrame(function() {
        $modal.find('.recovery-modal-card').addClass('modal-opened');
    });
}

function hideDestructiveConfirmModal() {
    var $modal = $('#destructiveConfirmModal');
    $modal.find('.recovery-modal-card').removeClass('modal-opened');
    $modal.removeClass('is-open').attr('aria-hidden', 'true');
    _destructiveConfirmCallback = null;
}

function openAprsPredictionSettingsModal(callsign) {
    var csKey = normalizeCallsign(callsign);
    if (!csKey) {
        return;
    }

    var override = getAprsPredictionOverride(csKey);
    var burstValue = override.hasOwnProperty('pred_burst') ? override.pred_burst : chase_config.pred_burst;
    var descentValue = override.hasOwnProperty('pred_desc_rate') ? override.pred_desc_rate : chase_config.pred_desc_rate;

    $('#aprsPredictionModalTitle').text('Prediction Settings for ' + csKey);
    $('#aprsPredictionCallsign').text(csKey);
    $('#aprsPredictionBurstAlt').val(normalizeAprsPredictionNumber(burstValue, chase_config.pred_burst).toFixed(0));
    $('#aprsPredictionDescentRate').val(normalizeAprsPredictionNumber(descentValue, chase_config.pred_desc_rate).toFixed(1));

    var $modal = getAprsPredictionModal();
    var $card = $modal.find('.aprs-prediction-modal-card');
    $modal.attr('data-callsign', csKey).addClass('is-open').attr('aria-hidden', 'false');
    $card.removeClass('modal-closing modal-opened').addClass('modal-opening');

    window.requestAnimationFrame(function() {
        $card.removeClass('modal-opening').addClass('modal-opened');
    });
}

function closeAprsPredictionSettingsModal() {
    var $modal = getAprsPredictionModal();
    var $card = $modal.find('.aprs-prediction-modal-card');

    $card.removeClass('modal-opening modal-opened').addClass('modal-closing');
    $card.one('transitionend', function() {
        $modal.removeClass('is-open').attr('aria-hidden', 'true');
        $card.removeClass('modal-closing');
    });

    window.setTimeout(function() {
        if ($modal.hasClass('is-open')) {
            $modal.removeClass('is-open').attr('aria-hidden', 'true');
            $card.removeClass('modal-closing');
        }
    }, 420);
}

function saveAprsPredictionSettingsModal() {
    var $modal = getAprsPredictionModal();
    var csKey = normalizeCallsign($modal.attr('data-callsign'));
    if (!csKey) {
        closeAprsPredictionSettingsModal();
        return;
    }

    var burstAlt = normalizeAprsPredictionNumber($('#aprsPredictionBurstAlt').val(), chase_config.pred_burst);
    var descentRate = normalizeAprsPredictionNumber($('#aprsPredictionDescentRate').val(), chase_config.pred_desc_rate);

    if (typeof socket !== 'undefined' && socket) {
        try {
            socket.emit('aprs_prediction_override_update', {
                callsign: csKey,
                pred_burst: burstAlt,
                pred_desc_rate: descentRate
            });
        } catch (e) {
            console.warn('Unable to save APRS prediction override:', e);
        }
    }

    closeAprsPredictionSettingsModal();
}

function createAprsListItem(cs, collecting) {
    var csKey = normalizeCallsign(cs);
    var li = $('<li>').addClass('list-group-item aprs-item');
    li.attr('data-callsign', csKey);
    li.attr('data-test', 'aprs-item-' + csKey);

    var row = $('<div>').addClass('d-flex flex-column aprs-row');
    var left = $('<div>').addClass('d-flex flex-column');
    var titleRow = $('<div>').addClass('d-flex justify-content-between align-items-center aprs-title-row');
    var titleLeft = $('<div>').addClass('d-flex align-items-center aprs-title-left');
    titleLeft.append($('<span>').addClass('aprs-staleness-light aprs-staleness-red').attr('title', 'No APRS data yet'));
    titleLeft.append($('<strong>').text(csKey));
    titleRow.append(titleLeft);

    var timeSpan = $('<div>').addClass('aprs-last-time text-muted').text('\u2014');
    if (collecting) {
        timeSpan.addClass('collecting').text('Collecting...');
    }
    titleRow.append(timeSpan);

    var locationRow = $('<div>').addClass('aprs-location-row aprs-detail-row');
    locationRow.append($('<span>').addClass('aprs-detail-label').text('Location'));
    locationRow.append($('<span>').addClass('aprs-detail-value aprs-location').text('\u2014'));

    var detailGrid = createAprsDetailGrid();

    left.append(titleRow).append(locationRow).append(detailGrid);

    var actionsRow = $('<div>').addClass('d-flex align-items-center gap-1 flex-wrap aprs-actions aprs-actions-row');
    var followBtn = createAprsActionButton(
        '<i class="fa fa-location-arrow" aria-hidden="true"></i>',
        'aprs-follow-fallback', csKey, 'btn-primary aprs-follow-btn',
        'follow', 'Follow callsign', 'Follow callsign ' + csKey
    ).attr('aria-pressed', 'false');
    var refreshBtn = createAprsActionButton(
        '<i class="fa fa-refresh" aria-hidden="true"></i>',
        'aprs-refresh-fallback', csKey, 'btn-info aprs-refresh-btn',
        'refresh', 'Force refresh callsign', 'Force refresh callsign ' + csKey
    );
    var recoveryBtn = createAprsActionButton(
        '<i class="fa fa-flag-o" aria-hidden="true"></i>',
        'aprs-recovery-fallback', csKey, 'btn-warning aprs-recovery-btn',
        'recover', 'Mark recovered', 'Mark recovered ' + csKey
    );
    var settingsBtn = createAprsActionButton(
        '<i class="fa fa-cog" aria-hidden="true"></i>',
        'aprs-settings-fallback', csKey, 'btn-secondary aprs-settings-btn',
        'settings', 'Prediction settings', 'Prediction settings ' + csKey
    );
    var viewBtn = createAprsActionButton(
        '<i class="fa fa-list-alt" aria-hidden="true"></i>',
        'aprs-view-fallback', csKey, 'btn-success aprs-view-btn',
        'view', 'View callsign summary', 'View callsign summary ' + csKey
    );
    var btn = createAprsActionButton(
        '<i class="fa fa-trash-o" aria-hidden="true"></i>',
        'aprs-remove-fallback', csKey, 'btn-danger aprs-remove-btn',
        'remove', 'Remove callsign', 'Remove callsign ' + csKey
    );
    // Reorder buttons for ergonomic layout and better fit: follow, summary, settings, refresh, recover, remove
    actionsRow.append(followBtn).append(viewBtn).append(settingsBtn).append(refreshBtn).append(recoveryBtn).append(btn);

    // Arrange: data on top (left), actions in a horizontal row below the data
    row.append(left).append(actionsRow);
    li.append(row);

    return li;
}

function setAprsRowStaleness(csKey, state) {
    var item = getAprsListElement().find('li[data-callsign="' + csKey + '"]');
    if (item.length === 0) {
        return;
    }

    var light = item.find('.aprs-staleness-light');
    if (light.length === 0) {
        return;
    }

    // Use single class update instead of multiple operations
    var titleMap = {green: 'Live APRS telemetry', yellow: 'Stale APRS telemetry', red: 'No recent APRS telemetry'};
    var classMap = {green: 'aprs-staleness-green', yellow: 'aprs-staleness-yellow', red: 'aprs-staleness-red'};
    
    light.removeClass('aprs-staleness-green aprs-staleness-yellow aprs-staleness-red')
         .addClass(classMap[state] || classMap.red)
         .attr('title', titleMap[state] || titleMap.red);
}

function updateAprsRowStaleness(csKey) {
    var timeoutMs = getAprsStatusTimeoutMs();
    if (!aprs_last_rx_ms.hasOwnProperty(csKey) || !aprs_telemetry_cache.hasOwnProperty(csKey)) {
        setAprsRowStaleness(csKey, 'red');
        return;
    }

    var ageMs = Date.now() - aprs_last_rx_ms[csKey];
    if (ageMs <= timeoutMs) {
        setAprsRowStaleness(csKey, 'green');
    } else {
        setAprsRowStaleness(csKey, 'yellow');
    }
}

function updateAllAprsRowStaleness() {
    var calls = chase_config.aprs_callsigns || [];
    calls.forEach(function(cs) {
        var key = normalizeCallsign(cs);
        if (!key) {
            return;
        }
        updateAprsRowStaleness(key);
    });
}

function setAprsRefreshPending(csKey, isPending) {
    var btn = getAprsListElement().find('li[data-callsign="' + csKey + '"] .aprs-refresh-btn');
    if (btn.length === 0) {
        return;
    }

    if (isPending) {
        btn.addClass('aprs-refresh-spinning').attr('aria-busy', 'true');
    } else {
        btn.removeClass('aprs-refresh-spinning').removeAttr('aria-busy');
    }
}

function getFollowedCallsign() {
    if (typeof balloon_currently_following === 'undefined' || balloon_currently_following === null) {
        return 'none';
    }

    return (balloon_currently_following || 'none').toString().toUpperCase();
}

function updateAprsFollowIndicators() {
    if (typeof balloon_currently_following === 'undefined') {
        return;
    }

    var followed = getFollowedCallsign();
    $('#aprsList li[data-callsign]').each(function() {
        var item = $(this);
        var csKey = (item.data('callsign') || '').toString().toUpperCase();
        var followBtn = item.find('.aprs-follow-btn');
        var isActive = followed !== 'NONE' && csKey === followed;
        var pressed = isActive ? 'true' : 'false';
        var title = isActive ? 'Stop following callsign' : 'Follow callsign';
        var ariaLabel = (isActive ? 'Stop following ' : 'Follow ') + csKey;

        // Batch attribute updates
        item.toggleClass('aprs-is-following', isActive);
        followBtn.toggleClass('is-active', isActive)
                 .attr({aria_pressed: pressed, title: title, 'aria-label': ariaLabel});
    });
}

function setFollowedCallsign(callsign) {
    var csKey = (callsign || '').toString().toUpperCase();
    balloon_currently_following = csKey || 'none';

    if (csKey && csKey !== 'NONE') {
        $('input:radio[name=autoFollow]').val(['payload']);
    }

    // Keep chase routing target in sync with the selected callsign.
    if (typeof window !== 'undefined' && typeof window.balloon_currently_chased !== 'undefined') {
        window.balloon_currently_chased = csKey || 'none';
    }

    updateAprsFollowIndicators();

    if (!csKey || csKey === 'NONE') {
        return;
    }

    if (typeof balloon_positions !== 'undefined' && balloon_positions.hasOwnProperty(csKey)) {
        var latest = balloon_positions[csKey].latest_data;
        if (latest && latest.position && latest.position.length >= 2) {
            if (get3DMapViewEnabled() && typeof window.focusCesiumOnCallsign === 'function' && window.focusCesiumOnCallsign(csKey, {duration: 1.2, alignToFollowViewport: true})) {
                return;
            }
            if (typeof window.panMapToVisibleCenter === 'function') {
                window.panMapToVisibleCenter(latest.position);
            } else if (typeof map !== 'undefined' && map) {
                map.panTo(latest.position);
            }
        }
    }
}

function toggleFollowedCallsign(callsign) {
    var csKey = normalizeCallsign(callsign);
    if (!csKey) {
        return;
    }

    if (getFollowedCallsign() === csKey) {
        balloon_currently_following = 'none';
        $('input:radio[name=autoFollow]').val(['none']);
        if (typeof window !== 'undefined' && typeof window.balloon_currently_chased !== 'undefined') {
            window.balloon_currently_chased = 'none';
        }
    } else {
        setFollowedCallsign(csKey);
    }

    updateAprsFollowIndicators();
}

function populateCesiumMapModeSelect() {
    var select = $('#cesiumMapModeSelect');
    if (select.length === 0) {
        return;
    }

    var modes = [];
    if (typeof window !== 'undefined' && typeof window.getCesiumMapModes === 'function') {
        try {
            modes = window.getCesiumMapModes();
        } catch (e) {
            modes = [];
        }
    }

    if (!Array.isArray(modes) || modes.length === 0) {
        modes = [{id: 'standard', label: 'Standard (OSM)'}];
    }

    select.empty();
    modes.forEach(function(mode) {
        if (!mode || !mode.id) {
            return;
        }
        select.append($('<option>').attr('value', mode.id).text(mode.label || mode.id));
    });

    var selectedMode = null;
    try {
        selectedMode = localStorage.getItem('chasemapper_cesium_map_mode');
    } catch (e) {
        selectedMode = null;
    }
    if (!selectedMode) {
        selectedMode = chase_config.cesium_map_mode || 'standard';
    }

    var hasSelected = modes.some(function(mode) {
        return mode && mode.id === selectedMode;
    });
    if (!hasSelected) {
        selectedMode = modes[0].id;
    }

    select.val(selectedMode);
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

function formatAprsLocation(telem) {
    if (!telem || !telem.position || telem.position.length < 2) {
        return '\u2014';
    }

    var lat = parseFloat(telem.position[0]);
    var lon = parseFloat(telem.position[1]);
    if (isNaN(lat) || isNaN(lon)) {
        return '\u2014';
    }

    return lat.toFixed(5) + ', ' + lon.toFixed(5);
}

function formatAprsTimestamp(telem) {
    if (!telem) {
        return '\u2014';
    }

    var rawTime = telem.packet_time || telem.time_dt || telem.timestamp || null;
    if (!rawTime) {
        return '\u2014';
    }

    var ts = new Date(rawTime);
    if (isNaN(ts.getTime())) {
        return '\u2014';
    }

    var timeZone = getAprsTimezone();

    try {
        return new Intl.DateTimeFormat(undefined, {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
            timeZoneName: 'short',
            timeZone: timeZone || undefined
        }).format(ts);
    } catch (e) {
        return ts.toLocaleString('en-US', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
            timeZoneName: 'short'
        });
    }
}

function formatAprsTableTime(telem) {
    if (!telem) {
        return '\u2014';
    }

    var rawTime = telem.packet_time || telem.time_dt || telem.timestamp || null;
    if (!rawTime) {
        return '\u2014';
    }

    var ts = new Date(rawTime);
    if (isNaN(ts.getTime())) {
        return '\u2014';
    }

    var timeZone = getAprsTimezone();

    try {
        return new Intl.DateTimeFormat(undefined, {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
            timeZone: timeZone || undefined
        }).format(ts);
    } catch (e) {
        return ts.toLocaleTimeString();
    }
}

function formatAprsAgeFromMs(ageMs) {
    if (!isFinite(ageMs) || ageMs < 0) {
        return '\u2014';
    }

    if (ageMs < 1000) {
        return '0s';
    }

    return Math.floor(ageMs / 1000).toString() + 's';
}

function formatAprsDuration(seconds) {
    if (!isFinite(seconds) || seconds < 0) {
        return '\u2014';
    }

    var total = Math.floor(seconds);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;

    if (h > 0) {
        return h + 'h ' + m + 'm';
    }
    if (m > 0) {
        return m + 'm ' + s + 's';
    }
    return s + 's';
}

function formatAprsLatLon(point) {
    if (!point || point.length < 2) {
        return '\u2014';
    }

    var lat = parseFloat(point[0]);
    var lon = parseFloat(point[1]);
    if (!isFinite(lat) || !isFinite(lon)) {
        return '\u2014';
    }

    return lat.toFixed(5) + ', ' + lon.toFixed(5);
}

function getAprsPredictionMeta(csKey) {
    var meta = aprs_prediction_meta_cache[csKey] || null;
    if (meta) {
        return meta;
    }

    if (typeof balloon_positions !== 'undefined' && balloon_positions.hasOwnProperty(csKey)) {
        var balloon = balloon_positions[csKey] || {};
        var predPoints = 0;
        try {
            if (balloon.pred_path && typeof balloon.pred_path.getLatLngs === 'function') {
                predPoints = balloon.pred_path.getLatLngs().length;
            }
        } catch (e) {
            predPoints = 0;
        }

        return {
            last_prediction_ms: NaN,
            pred_path_points: predPoints,
            pred_landing: balloon.pred_marker && balloon.pred_marker.getLatLng ? [balloon.pred_marker.getLatLng().lat, balloon.pred_marker.getLatLng().lng, 0] : [],
            burst: balloon.burst_marker && balloon.burst_marker.getLatLng ? [balloon.burst_marker.getLatLng().lat, balloon.burst_marker.getLatLng().lng, 0] : [],
            abort_landing: balloon.abort_marker && balloon.abort_marker.getLatLng ? [balloon.abort_marker.getLatLng().lat, balloon.abort_marker.getLatLng().lng, 0] : []
        };
    }

    return null;
}

function cacheAprsPredictionMeta(data) {
    if (!data || !data.callsign) {
        return;
    }

    var csKey = normalizeCallsign(data.callsign);
    if (!csKey) {
        return;
    }

    var predPathPoints = Array.isArray(data.pred_path) ? data.pred_path.length : 0;
    aprs_prediction_meta_cache[csKey] = {
        last_prediction_ms: Date.now(),
        pred_path_points: predPathPoints,
        pred_landing: Array.isArray(data.pred_landing) ? data.pred_landing : [],
        burst: Array.isArray(data.burst) ? data.burst : [],
        abort_landing: Array.isArray(data.abort_landing) ? data.abort_landing : []
    };
}

function estimateLandingEtaSeconds(telem, landingPoint) {
    if (!telem || !telem.position || telem.position.length < 2 || !landingPoint || landingPoint.length < 2) {
        return NaN;
    }

    if (telem.time_to_landing && telem.time_to_landing !== '' && telem.time_to_landing !== 'LANDED') {
        var ttlParts = telem.time_to_landing.split(':');
        if (ttlParts.length === 2) {
            var mins = parseInt(ttlParts[0], 10);
            var secs = parseInt(ttlParts[1], 10);
            if (!isNaN(mins) && !isNaN(secs)) {
                return (mins * 60) + secs;
            }
        }
    }

    var speedMs = parseFloat(telem.speed);
    if (!isFinite(speedMs) || speedMs <= 0.5 || typeof calculate_lookangles !== 'function') {
        return NaN;
    }

    var look = calculate_lookangles(
        {lat: parseFloat(telem.position[0]), lon: parseFloat(telem.position[1]), alt: parseFloat(telem.position[2] || 0)},
        {lat: parseFloat(landingPoint[0]), lon: parseFloat(landingPoint[1]), alt: parseFloat(landingPoint[2] || 0)}
    );

    if (!look || !isFinite(look.range) || look.range <= 0) {
        return NaN;
    }

    return look.range / speedMs;
}

function buildAprsSummarySnapshot(csKey) {
    var telem = aprs_telemetry_cache[csKey] || (typeof balloon_positions !== 'undefined' && balloon_positions[csKey] ? balloon_positions[csKey].latest_data : null);
    var values = formatAprsTelemetryValue(telem);
    var packetText = formatAprsTimestamp(telem);
    var locationText = formatAprsLocation(telem);
    var maxAltText = '\u2014';
    var ttlText = '\u2014';
    var freshnessText = 'No APRS data yet';

    if (telem && telem.max_alt !== undefined && isFinite(parseFloat(telem.max_alt))) {
        var maxAltM = parseFloat(telem.max_alt);
        maxAltText = (chase_config.unitselection === 'imperial') ? ((maxAltM * 3.28084).toFixed(0) + ' ft') : (maxAltM.toFixed(0) + ' m');
    }

    if (telem && telem.time_to_landing) {
        ttlText = telem.time_to_landing;
    }

    if (aprs_last_rx_ms.hasOwnProperty(csKey)) {
        var ageMs = Date.now() - aprs_last_rx_ms[csKey];
        var timeoutMs = getAprsStatusTimeoutMs();
        freshnessText = ageMs <= timeoutMs ? ('Fresh (' + formatAprsAgeFromMs(ageMs) + ' ago)') : ('Stale (' + formatAprsAgeFromMs(ageMs) + ' ago)');
    }

    var predMeta = getAprsPredictionMeta(csKey);
    var predAgeText = '\u2014';
    var predTimeText = '\u2014';
    var predPointsText = '\u2014';
    var landingText = '\u2014';
    var burstText = '\u2014';
    var abortText = '\u2014';
    var landingRangeText = '\u2014';
    var etaText = '\u2014';

    if (predMeta) {
        if (isFinite(predMeta.last_prediction_ms)) {
            predAgeText = formatAprsAgeFromMs(Date.now() - predMeta.last_prediction_ms);
            predTimeText = formatAprsTimestamp({packet_time: new Date(predMeta.last_prediction_ms).toISOString()});
        }
        predPointsText = (predMeta.pred_path_points || 0).toString();
        landingText = formatAprsLatLon(predMeta.pred_landing);
        burstText = formatAprsLatLon(predMeta.burst);
        abortText = formatAprsLatLon(predMeta.abort_landing);

        if (telem && telem.position && predMeta.pred_landing && predMeta.pred_landing.length >= 2 && typeof calculate_lookangles === 'function') {
            var lookToLanding = calculate_lookangles(
                {lat: parseFloat(telem.position[0]), lon: parseFloat(telem.position[1]), alt: parseFloat(telem.position[2] || 0)},
                {lat: parseFloat(predMeta.pred_landing[0]), lon: parseFloat(predMeta.pred_landing[1]), alt: parseFloat(predMeta.pred_landing[2] || 0)}
            );

            if (lookToLanding && isFinite(lookToLanding.range)) {
                if (chase_config.unitselection === 'imperial') {
                    landingRangeText = (lookToLanding.range * 0.000621371).toFixed(1) + ' mi';
                } else {
                    landingRangeText = (lookToLanding.range / 1000.0).toFixed(1) + ' km';
                }
            }

            var etaSeconds = estimateLandingEtaSeconds(telem, predMeta.pred_landing);
            etaText = formatAprsDuration(etaSeconds);
        }
    }

    return {
        callsign: csKey,
        packet: packetText,
        freshness: freshnessText,
        position: locationText,
        alt: values.alt,
        speed: values.speed,
        ascent: values.ascent,
        az: values.az,
        el: values.el,
        range: values.range,
        max_alt: maxAltText,
        ttl: ttlText,
        pred_age: predAgeText,
        pred_time: predTimeText,
        pred_points: predPointsText,
        landing: landingText,
        landing_range: landingRangeText,
        eta: etaText,
        burst: burstText,
        abort: abortText
    };
}

function renderAprsCallsignSummaryModal(csKey) {
    var snapshot = buildAprsSummarySnapshot(csKey);

    $('#aprsCallsignModalTitle').text('Callsign Summary: ' + csKey);
    $('#aprsCallsignSummaryCallsign').text(snapshot.callsign);
    $('#aprsCallsignSummaryPacket').text(snapshot.packet);
    $('#aprsCallsignSummaryFreshness').text(snapshot.freshness);
    $('#aprsCallsignSummaryPosition').text(snapshot.position);
    $('#aprsCallsignSummaryAlt').text(snapshot.alt);
    $('#aprsCallsignSummarySpeed').text(snapshot.speed);
    $('#aprsCallsignSummaryAscent').text(snapshot.ascent);
    $('#aprsCallsignSummaryAz').text(snapshot.az);
    $('#aprsCallsignSummaryEl').text(snapshot.el);
    $('#aprsCallsignSummaryRange').text(snapshot.range);
    $('#aprsCallsignSummaryMaxAlt').text(snapshot.max_alt);
    $('#aprsCallsignSummaryTTL').text(snapshot.ttl);
    $('#aprsCallsignSummaryPredAge').text(snapshot.pred_age);
    $('#aprsCallsignSummaryPredTime').text(snapshot.pred_time);
    $('#aprsCallsignSummaryPredPoints').text(snapshot.pred_points);
    $('#aprsCallsignSummaryLanding').text(snapshot.landing);
    $('#aprsCallsignSummaryLandingRange').text(snapshot.landing_range);
    $('#aprsCallsignSummaryETA').text(snapshot.eta);
    $('#aprsCallsignSummaryBurst').text(snapshot.burst);
    $('#aprsCallsignSummaryAbort').text(snapshot.abort);
}

function openAprsCallsignSummaryModal(csKey) {
    var key = normalizeCallsign(csKey);
    if (!key) {
        return;
    }

    var $modal = $('#aprsCallsignModal');
    var $card = $modal.find('.recovery-modal-card');
    $modal.attr('data-callsign', key).addClass('is-open').attr('aria-hidden', 'false');
    $card.removeClass('modal-closing modal-opened').addClass('modal-opening');
    window.requestAnimationFrame(function() {
        $card.removeClass('modal-opening').addClass('modal-opened');
    });
    renderAprsCallsignSummaryModal(key);
}

function closeAprsCallsignSummaryModal() {
    var $modal = $('#aprsCallsignModal');
    var $card = $modal.find('.recovery-modal-card');
    if (!$modal.hasClass('is-open')) {
        return;
    }

    $card.removeClass('modal-opened').addClass('modal-closing');
    $modal.removeClass('is-open').attr('aria-hidden', 'true');
    window.setTimeout(function() {
        if ($modal.hasClass('is-open')) {
            return;
        }
        $card.removeClass('modal-closing');
    }, 420);
}

window.cacheAprsPredictionMeta = cacheAprsPredictionMeta;

function getButtonGroupValue(groupSelector) {
    var active = $(groupSelector).find('.button-select-btn.is-active, .log-filter-btn.is-active').first();
    return active.length > 0 ? active.data('value') || active.data('log-level') : null;
}

function setButtonGroupValue(groupSelector, value, dataAttrName) {
    var buttons = $(groupSelector).find('button');
    buttons.removeClass('is-active').attr('aria-pressed', 'false');
    buttons.each(function() {
        var buttonValue = $(this).data(dataAttrName);
        if ((buttonValue || '').toString() === (value || '').toString()) {
            $(this).addClass('is-active').attr('aria-pressed', 'true');
        }
    });
}

function getSelectedLogLevels() {
    var selected = [];
    $('#logLevelFilter .log-filter-btn.is-active').each(function() {
        var level = ($(this).data('log-level') || '').toString();
        if (level) {
            selected.push(level);
        }
    });
    return selected;
}

function setSelectedLogLevels(levels) {
    var activeLevels = Array.isArray(levels) && levels.length > 0 ? levels : ['debug', 'info', 'warn', 'error'];
    $('#logLevelFilter .log-filter-btn').each(function() {
        var level = ($(this).data('log-level') || '').toString();
        var isActive = activeLevels.indexOf(level) !== -1;
        $(this).toggleClass('is-active', isActive).attr('aria-pressed', isActive ? 'true' : 'false');
    });
}

function renderAprsTelemetryRow(cs) {
    var csKey = (cs || '').toString().toUpperCase();
    var item = getAprsListElement().find('li[data-callsign="' + csKey + '"]');
    if (item.length === 0) {
        return;
    }

    var telem = aprs_telemetry_cache[csKey];
    if (!telem) {
        return;
    }

    var values = formatAprsTelemetryValue(telem);
    // Batch DOM updates to reduce layout thrashing
    item.find('.aprs-location').text(formatAprsLocation(telem));
    item.find('.aprs-last-time').removeClass('collecting').text(formatAprsTimestamp(telem));
    item.find('.aprs-val-alt').text(values.alt);
    item.find('.aprs-val-speed').text(values.speed);
    item.find('.aprs-val-ascent').text(values.ascent);
    item.find('.aprs-val-az').text(values.az);
    item.find('.aprs-val-el').text(values.el);
    item.find('.aprs-val-range').text(values.range);
    
    updateAprsFollowIndicators();
    updateAprsRowStaleness(csKey);
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
    var packetMs = parseAprsPacketTimeMs(telem);
    if (isNaN(packetMs) == false) {
        aprs_last_rx_ms[csKey] = packetMs;
    } else if (aprs_last_rx_ms.hasOwnProperty(csKey) == false) {
        delete aprs_last_rx_ms[csKey];
    }

    if (aprs_refresh_pending.hasOwnProperty(csKey) && aprs_last_rx_ms[csKey] >= aprs_refresh_pending[csKey]) {
        delete aprs_refresh_pending[csKey];
        setAprsRefreshPending(csKey, false);
    }

    if (csKey === 'CAR') {
        refreshAprsTelemetryRows();
        return;
    }

    // If APRS telemetry exists but map state has not yet been created, backfill it.
    if (typeof balloon_positions !== 'undefined' && !balloon_positions.hasOwnProperty(csKey)) {
        if (typeof initial_load_complete !== 'undefined' && initial_load_complete && typeof handleTelemetry === 'function') {
            handleTelemetry(telem);
        } else if (typeof pending_telemetry_updates !== 'undefined' && Array.isArray(pending_telemetry_updates)) {
            pending_telemetry_updates.push(telem);
        }
    }

    var hasRow = getAprsListElement().find('li[data-callsign="' + csKey + '"]').length > 0;
    if (!hasRow) {
        return;
    }

    renderAprsTelemetryRow(csKey);
    updateAprsStatusIndicator();
}

function syncUnitAndTimezoneFromUI() {
    if ($('#unitSelection').length > 0) {
           chase_config.unitselection = getButtonGroupValue('#unitSelection') || 'metric';
    }

    if ($('#timezoneSelection').length > 0) {
        var timezone = ($('#timezoneSelection').val() || 'local').trim();
        chase_config.aprs_timezone = timezone === '' ? 'local' : timezone;
    }
}

function refreshDerivedDisplaysForSettings() {
    if ($('#unitSelection').length > 0) {
        if (typeof refreshTelemetryTableColumns === 'function') {
            refreshTelemetryTableColumns();
        }
        if (typeof refreshAprsTelemetryRows === 'function') {
            refreshAprsTelemetryRows();
        }
        if (typeof updateTelemetryTable === 'function') {
            updateTelemetryTable();
        }
    }

    if ($('#timezoneSelection').length > 0 && typeof refreshAprsTelemetryRows === 'function') {
        refreshAprsTelemetryRows();
    }
}

function backfillAprsMarkersFromCache() {
    if (typeof balloon_positions === 'undefined' || typeof handleTelemetry !== 'function') {
        return;
    }
    if (typeof initial_load_complete === 'undefined' || initial_load_complete !== true) {
        return;
    }

    var calls = chase_config.aprs_callsigns || [];
    calls.forEach(function(cs) {
        var key = (cs || '').toString().toUpperCase();
        if (!key || balloon_positions.hasOwnProperty(key)) {
            return;
        }

        var telem = aprs_telemetry_cache[key];
        if (telem && telem.callsign) {
            handleTelemetry(telem);
        }
    });
}


function serverSettingsUpdate(data){
    // Accept a json blob of settings data from the client, and update our local store.
    var previousAprsCallsigns = Array.isArray(chase_config.aprs_callsigns) ? chase_config.aprs_callsigns.slice() : [];
    chase_config = data;
    if (typeof chase_config.pred_model_time !== 'string') {
        chase_config.pred_model_time = '—';
    }
    if (!chase_config.aprs_prediction_overrides || typeof chase_config.aprs_prediction_overrides !== 'object') {
        chase_config.aprs_prediction_overrides = {};
    }
    // Update a few fields based on this data.
    setPredictorModelDisplay(chase_config.pred_model, chase_config.pred_model_time);
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
    setButtonGroupValue('#unitSelection', localStorage.getItem('chasemapper_units') || chase_config.unitselection || 'metric', 'value');
    $('#timezoneSelection').val(chase_config.aprs_timezone || 'local');
    populateTimezoneOptions();
    setButtonGroupValue('#themeSelect', localStorage.getItem('chasemapper_theme') || 'light', 'value');
    if (typeof populateCesiumMapModeSelect === 'function') {
        populateCesiumMapModeSelect();
    }
    
    // Chase Car Speedometer
    $('#showCarSpeed').prop('checked', chase_config.chase_car_speed);

    // APRS settings
    try {
        // populate callsigns list (with last-beacon timestamp placeholder)
        getAprsListElement().empty();
        var currentAprsCallsigns = [];
        if (chase_config.aprs_callsigns && chase_config.aprs_callsigns.length > 0){
            chase_config.aprs_callsigns.forEach(function(cs){
                var key = (cs || '').toString().toUpperCase();
                if (!key) {
                    return;
                }
                currentAprsCallsigns.push(key);
                getAprsListElement().append(createAprsListItem(key, false));
                if (!aprs_telemetry_cache[key] && typeof balloon_positions !== 'undefined' && balloon_positions[key] && balloon_positions[key].latest_data) {
                    aprs_telemetry_cache[key] = balloon_positions[key].latest_data;
                    var cachedPacketMs = parseAprsPacketTimeMs(balloon_positions[key].latest_data);
                    if (isNaN(cachedPacketMs) == false) {
                        aprs_last_rx_ms[key] = cachedPacketMs;
                    }
                }
                renderAprsTelemetryRow(key);
                updateAprsRowStaleness(key);
            });
        }
        previousAprsCallsigns.forEach(function(cs) {
            var key = (cs || '').toString().toUpperCase();
            if (!key || currentAprsCallsigns.indexOf(key) !== -1) {
                return;
            }
            delete aprs_telemetry_cache[key];
            delete aprs_last_rx_ms[key];
            delete aprs_refresh_pending[key];
            if (typeof balloon_positions !== 'undefined' && balloon_positions.hasOwnProperty(key)) {
                try {
                    if (typeof hideBalloon === 'function') {
                        hideBalloon(key);
                    }
                    delete balloon_positions[key];
                } catch (e) {
                    console.warn('Error removing stale APRS balloon for', key, e);
                }
            }
        });
        updateAprsFollowIndicators();
            backfillAprsMarkersFromCache();
        $('#aprsPollInterval').val(chase_config.aprs_poll_interval || 30);
        apply3DMapViewState();
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

    if (!chase_config.aprs_prediction_overrides || typeof chase_config.aprs_prediction_overrides !== 'object') {
        chase_config.aprs_prediction_overrides = {};
    }

    var unitSelection = getButtonGroupValue('#unitSelection') || 'metric';
    chase_config.unitselection = unitSelection;
    syncUnitAndTimezoneFromUI();

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

    refreshDerivedDisplaysForSettings();
};

// APRS UI helpers
$(document).on('click', '#aprsAddBtn', function(){
    var cs = $('#aprsCallInput').val().trim();
    if (cs === '') return;
    cs = cs.toUpperCase();
    var list = getAprsListElement();
    if (list.length > 0 && list.find('li[data-callsign="' + cs + '"]').length === 0) {
        list.append(createAprsListItem(cs, true));
        // Create a placeholder balloon marker so the newly-added APRS callsign
        // is visible on the map immediately (even before any telemetry arrives).
        try {
            if (typeof balloon_positions !== 'undefined' && !balloon_positions.hasOwnProperty(cs) && typeof add_new_balloon === 'function') {
                var ref = getAprsReferencePosition();
                if (ref) {
                    add_new_balloon({
                        telem: {
                            callsign: cs,
                            position: [ref.lat, ref.lon, ref.alt],
                            vel_v: 0,
                            speed: 0,
                            max_alt: 0
                        },
                        path: [],
                        pred_path: [],
                        pred_landing: [],
                        burst: [],
                        abort_path: [],
                        abort_landing: []
                    });
                }
            }
        } catch (e) {
            console.warn('Failed to create APRS placeholder marker for', cs, e);
        }
    }
    if (typeof socket !== 'undefined' && socket) {
        socket.emit('aprs_callsign_add', {callsign: cs});
    }
    $('#aprsCallInput').val('');
    updateAprsFollowIndicators();
    updateAprsStatusIndicator();
});

$(document).on('keydown', '#aprsCallInput', function(e){
    if (e.key === 'Enter' || e.which === 13) {
        e.preventDefault();
        $('#aprsAddBtn').trigger('click');
    }
});

$(document).on('click', '.aprs-remove-btn', function(e){
    e.stopPropagation && e.stopPropagation();
    e.preventDefault && e.preventDefault();
    var cs = ($(this).data('callsign') || '').toString().toUpperCase();
    handleAprsCallsignRemoved({callsign: cs});
    if (typeof socket !== 'undefined' && socket) {
        socket.emit('aprs_callsign_remove', {callsign: cs});
    }
});

$(document).on('click', '.aprs-follow-btn', function(e){
    e = e || window.event;
    if (e.stopPropagation) e.stopPropagation();
    if (e.preventDefault) e.preventDefault();
    var cs = ($(this).data('callsign') || '').toString().toUpperCase();
    if (!cs) {
        return;
    }
    toggleFollowedCallsign(cs);
});

$(document).on('click', '.aprs-refresh-btn', function(e){
    e = e || window.event;
    if (e.stopPropagation) e.stopPropagation();
    if (e.preventDefault) e.preventDefault();
    var cs = ($(this).data('callsign') || '').toString().toUpperCase();
    if (!cs) {
        return;
    }
    aprs_refresh_pending[cs] = Date.now();
    setAprsRefreshPending(cs, true);
    if (typeof socket !== 'undefined' && socket) {
        socket.emit('aprs_refresh_request', {callsign: cs});
    }
});

$(document).on('click', '.aprs-recovery-btn', function(e){
    e = e || window.event;
    if (e.stopPropagation) e.stopPropagation();
    if (e.preventDefault) e.preventDefault();
    var cs = ($(this).data('callsign') || '').toString().toUpperCase();
    if (!cs) {
        return;
    }
    markPayloadRecovered(cs);
});

$(document).on('click', '.aprs-settings-btn', function(e){
    e = e || window.event;
    if (e.stopPropagation) e.stopPropagation();
    if (e.preventDefault) e.preventDefault();
    var cs = ($(this).data('callsign') || '').toString().toUpperCase();
    if (!cs) {
        return;
    }
    openAprsPredictionSettingsModal(cs);
});

$(document).on('click', '.aprs-view-btn', function(e){
    e = e || window.event;
    if (e.stopPropagation) e.stopPropagation();
    if (e.preventDefault) e.preventDefault();
    var cs = ($(this).data('callsign') || '').toString().toUpperCase();
    if (!cs) {
        return;
    }
    openAprsCallsignSummaryModal(cs);
});

$(document).on('input change', '#cesiumCameraSliderInput', function(){
    var pitch = parseFloat($(this).val());
    if (isNaN(pitch)) {
        return;
    }
    if (typeof setCesiumCameraPitch === 'function') {
        setCesiumCameraPitch(pitch);
    }
});

$(document).on('click', '#cesiumCameraSliderCloseBtn', function(e){
    e = e || window.event;
    if (e.preventDefault) e.preventDefault();
    if (typeof hideCesiumCameraSlider === 'function') {
        hideCesiumCameraSlider();
    }
});

$(document).on('click', '#aprsPredictionModalCancelBtn, [data-aprs-prediction-close="true"]', function(){
    closeAprsPredictionSettingsModal();
});

$(document).on('click', '[data-aprs-callsign-close="true"]', function(){
    closeAprsCallsignSummaryModal();
});

$(document).on('click', '#aprsPredictionModalSubmitBtn', function(){
    saveAprsPredictionSettingsModal();
});

$(document).on('keydown', function(e){
    if (e.key !== 'Escape') {
        return;
    }

    if ($('#aprsPredictionModal').hasClass('is-open')) {
        closeAprsPredictionSettingsModal();
    }

    if ($('#aprsCallsignModal').hasClass('is-open')) {
        closeAprsCallsignSummaryModal();
    }
});

function handleAprsRefreshComplete(data) {
    var cs = data && data.callsign ? data.callsign.toString().toUpperCase() : '';
    if (!cs) {
        return;
    }
    delete aprs_refresh_pending[cs];
    setAprsRefreshPending(cs, false);
}

function handleAprsCallsignRemoved(data) {
    var cs = data && data.callsign ? data.callsign.toString().toUpperCase() : '';
    if (!cs) {
        return;
    }

    delete aprs_telemetry_cache[cs];
    delete aprs_last_rx_ms[cs];
    delete aprs_refresh_pending[cs];
    delete aprs_prediction_meta_cache[cs];

    var summaryModal = $('#aprsCallsignModal');
    var activeCs = (summaryModal.attr('data-callsign') || '').toString().toUpperCase();
    if (summaryModal.hasClass('is-open') && activeCs === cs) {
        closeAprsCallsignSummaryModal();
    }

    if (typeof balloon_positions !== 'undefined' && balloon_positions.hasOwnProperty(cs)) {
        try {
            if (typeof hideBalloon === 'function') {
                hideBalloon(cs);
            }
            delete balloon_positions[cs];
        } catch (e) {
            console.warn('Error removing balloon layers for', cs, e);
        }
    }

    getAprsListElement().find('li[data-callsign="' + cs + '"]').remove();

    if (getFollowedCallsign() === cs) {
        balloon_currently_following = 'none';
        if (typeof window !== 'undefined' && typeof window.balloon_currently_chased !== 'undefined') {
            window.balloon_currently_chased = 'none';
        }
    }

    updateAprsFollowIndicators();
    updateAprsStatusIndicator();
}

function showAprsPanel(callsign) {
    // Show the APRS section in the settings panel
    if (typeof showSettingsPanel === 'function') {
        showSettingsPanel('aprs');
    }
    
    // Find the matching callsign row in the APRS list and highlight it
    var csKey = (callsign || '').toString().toUpperCase();
    var row = $('#aprsList').find('li[data-callsign="' + csKey + '"]');
    
    if (row.length > 0) {
        // Scroll the row into view after the panel animation completes
        setTimeout(function() {
            row[0].scrollIntoView({behavior: 'smooth', block: 'nearest'});
            
            // Apply highlight animation
            row.addClass('highlight');
            
            // Remove highlight after 2 seconds
            setTimeout(function() {
                row.removeClass('highlight');
            }, 2000);
        }, 300);
    }
}

function registerAprsSocketHandlers() {
    if (typeof socket === 'undefined' || !socket || socket._chasemapperAprsHandlersRegistered) {
        return;
    }

    socket.on('aprs_refresh_complete', handleAprsRefreshComplete);
    socket.on('aprs_callsign_removed', handleAprsCallsignRemoved);
    socket._chasemapperAprsHandlersRegistered = true;
}

$(document).on('click', '#unitSelection .button-select-btn', function(){
    var val = $(this).data('value');
    setButtonGroupValue('#unitSelection', val, 'value');
    try { localStorage.setItem('chasemapper_units', val); } catch(e) { /* ignore */ }
    clientSettingsUpdate();
});

$(document).on('change', '#timezoneSelection', function(){
    clientSettingsUpdate();
});

$(document).on('click', '#destructiveConfirmModalCancelBtn, [data-destructive-close="true"]', function(){
    hideDestructiveConfirmModal();
});

$(document).on('click', '#destructiveConfirmModalSubmitBtn', function(){
    var callback = _destructiveConfirmCallback;
    hideDestructiveConfirmModal();
    if (callback) {
        callback();
    }
});

// Theme selector and use-current-location handler
$(document).on('click', '#themeSelect .button-select-btn', function(){
    var val = $(this).data('value');
    setButtonGroupValue('#themeSelect', val, 'value');
    localStorage.setItem('chasemapper_theme', val);
    if (val === 'dark') applyTheme(true); else applyTheme(false);
});

$(document).on('click', '#timezoneOptions option', function(){
    clientSettingsUpdate();
});

$(document).on('change', '#cesiumMapModeSelect', function(){
    var mode = ($(this).val() || '').toString();
    if (!mode) {
        return;
    }

    chase_config.cesium_map_mode = mode;
    try {
        localStorage.setItem('chasemapper_cesium_map_mode', mode);
    } catch (e) {
        // ignore storage failures
    }

    if (typeof window !== 'undefined' && typeof window.applyCesiumMapMode === 'function') {
        window.applyCesiumMapMode(mode, {persist: false});
    }
});

$(document).on('click', '#useCurrentLocation', function(){
    if (navigator && navigator.geolocation){
        navigator.geolocation.getCurrentPosition(function(pos){
            $('#currentLocationDisplay').text(pos.coords.latitude.toFixed(5)+', '+pos.coords.longitude.toFixed(5));
            chase_config.default_lat = pos.coords.latitude;
            chase_config.default_lon = pos.coords.longitude;
            clientSettingsUpdate();
            if (typeof window !== 'undefined' && typeof window.syncAllCesiumStateFromStore === 'function') {
                window.syncAllCesiumStateFromStore();
            }
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
    if (typeof window !== 'undefined' && typeof window.syncAllCesiumStateFromStore === 'function') {
        window.syncAllCesiumStateFromStore();
    }
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
    updateAllAprsRowStaleness();

    var now = Date.now();
    Object.keys(aprs_refresh_pending).forEach(function(csKey) {
        if ((now - aprs_refresh_pending[csKey]) > 20000) {
            delete aprs_refresh_pending[csKey];
            setAprsRefreshPending(csKey, false);
        }
    });

    var summaryModal = $('#aprsCallsignModal');
    if (summaryModal.hasClass('is-open')) {
        var activeCs = (summaryModal.attr('data-callsign') || '').toString().toUpperCase();
        if (activeCs) {
            renderAprsCallsignSummaryModal(activeCs);
        }
    }
}, 2000);

// ===== Panel Resizing with Snap Points =====
(function() {
    function computeMaxOpenHeight() {
        var dock = document.getElementById('menuDock');
        var topbar = document.getElementById('topbar');

        if (!dock) {
            return Math.max(180, Math.floor(window.innerHeight - 80));
        }

        var style = window.getComputedStyle(dock);
        var bottom = parseFloat(style.bottom);
        var bottomPx = isFinite(bottom) ? bottom : 14;
        var paddingTop = parseFloat(style.paddingTop) || 0;
        var paddingBottom = parseFloat(style.paddingBottom) || 0;
        var borderTop = parseFloat(style.borderTopWidth) || 0;
        var borderBottom = parseFloat(style.borderBottomWidth) || 0;
        var topbarHeight = topbar ? topbar.offsetHeight : 56;
        var dockChrome = paddingTop + paddingBottom + borderTop + borderBottom + topbarHeight;

        return Math.max(180, Math.floor(window.innerHeight - bottomPx - dockChrome));
    }

    window.getSettingsPanelSnapOpenHeight = computeMaxOpenHeight;

    function getActivePanelElement() {
        var settingsPanel = document.getElementById('settingsPanel');
        if (settingsPanel && settingsPanel.classList.contains('panel-open')) {
            return settingsPanel;
        }

        var logPanel = document.getElementById('logPanel');
        if (logPanel && logPanel.classList.contains('panel-open')) {
            return logPanel;
        }

        return settingsPanel || logPanel || null;
    }

    function getPanelChromeHeight(panel) {
        if (!panel) {
            return 52;
        }

        var header = panel.querySelector('.settings-header, .log-panel-header');
        var handle = panel.querySelector('.panel-resize-handle');
        var borderTop = parseFloat(window.getComputedStyle(panel).borderTopWidth) || 0;
        var borderBottom = parseFloat(window.getComputedStyle(panel).borderBottomWidth) || 0;
        var headerHeight = header ? header.offsetHeight : 48;
        var handleHeight = handle ? handle.offsetHeight : 4;

        return Math.round(headerHeight + handleHeight + borderTop + borderBottom);
    }

    function getAprsItemStepHeight() {
        var items = document.querySelectorAll('#aprsList .aprs-item');
        if (items.length >= 2) {
            var step = items[1].offsetTop - items[0].offsetTop;
            if (step > 0) {
                return step;
            }
        }

        if (items.length === 1) {
            var style = window.getComputedStyle(items[0]);
            var margins = (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
            return Math.max(64, Math.round(items[0].offsetHeight + margins));
        }

        return 92;
    }

    function getSnapHeights(panel) {
        var maxOpen = computeMaxOpenHeight();
        var chrome = getPanelChromeHeight(panel);
        var itemStep = getAprsItemStepHeight();
        var heights = [0, maxOpen];
        var n = 1;

        while (n <= 60) {
            var candidate = Math.round(chrome + (itemStep * n));
            if (candidate >= maxOpen) {
                break;
            }
            heights.push(candidate);
            n += 1;
        }

        heights.sort(function(a, b) { return a - b; });
        return heights;
    }

    function findNearestSnapHeight(height, panel) {
        var snaps = getSnapHeights(panel);
        var candidate = Math.max(0, Math.round(height || 0));
        var nearest = snaps[0];
        var bestDelta = Math.abs(candidate - nearest);

        for (var i = 1; i < snaps.length; i++) {
            var delta = Math.abs(candidate - snaps[i]);
            if (delta < bestDelta) {
                bestDelta = delta;
                nearest = snaps[i];
            }
        }

        return nearest;
    }

    function applySharedPanelHeight(height, persistHeight, panel) {
        var panelId = panel && panel.id ? panel.id : null;
        if (typeof window.setDockPanelHeight === 'function') {
            return window.setDockPanelHeight(height, persistHeight, panelId);
        }

        var safeHeight = Math.max(0, Math.min(computeMaxOpenHeight(), Math.round(height || 0)));
        var settingsPanel = document.getElementById('settingsPanel');
        var logPanel = document.getElementById('logPanel');

        if (settingsPanel) {
            settingsPanel.style.height = safeHeight + 'px';
            settingsPanel.style.maxHeight = safeHeight + 'px';
        }
        if (logPanel) {
            logPanel.style.height = safeHeight + 'px';
            logPanel.style.maxHeight = safeHeight + 'px';
        }
        return safeHeight;
    }

    function initResizer() {
        var resizeHandles = Array.prototype.slice.call(document.querySelectorAll('.panel-resize-handle[data-resize-target]'));
        var isDragging = false;
        var startY = 0;
        var startHeight = 0;
        var lastDragClientY = 0;
        var activeHandle = null;
        var activePanel = null;

        if (resizeHandles.length === 0) {
            return;
        }

        function bindHandle(resizeHandle) {
            if (!resizeHandle || resizeHandle.dataset.resizeBound === '1') {
                return;
            }

            resizeHandle.dataset.resizeBound = '1';

            resizeHandle.addEventListener('mousedown', function(e) {
                if (e.button !== 0) {
                    return;
                }

                var panelId = (resizeHandle.dataset.resizeTarget || '').trim();
                var panel = panelId ? document.getElementById(panelId) : getActivePanelElement();
                if (!panel) {
                    return;
                }

                isDragging = true;
                activeHandle = resizeHandle;
                activePanel = panel;
                startY = e.clientY;
                lastDragClientY = e.clientY;
                startHeight = panel.clientHeight;

                resizeHandle.classList.add('is-dragging');
                document.body.style.userSelect = 'none';
                document.body.style.cursor = 'ns-resize';

                e.preventDefault();
            });
        }

        resizeHandles.forEach(bindHandle);

        function applyHeight(height, persistHeight, panel) {
            var safeHeight = applySharedPanelHeight(height, persistHeight, panel || activePanel);

            if (safeHeight === 0) {
                var settingsPanel = document.getElementById('settingsPanel');
                var logPanel = document.getElementById('logPanel');
                if (settingsPanel) {
                    settingsPanel.classList.remove('panel-open');
                }
                if (logPanel) {
                    logPanel.classList.remove('panel-open');
                }
                if (typeof setTopbarSelection === 'function') {
                    setTopbarSelection('none');
                }
            }

            return safeHeight;
        }

        document.addEventListener('mousemove', function(e) {
            if (!isDragging) {
                return;
            }

            lastDragClientY = e.clientY;
            var delta = startY - e.clientY;
            applyHeight(startHeight + delta, false, activePanel);
        });

        document.addEventListener('mouseup', function(e) {
            if (!isDragging) {
                return;
            }

            isDragging = false;
            if (activeHandle) {
                activeHandle.classList.remove('is-dragging');
            }
            document.body.style.userSelect = '';
            document.body.style.cursor = '';

            lastDragClientY = e && typeof e.clientY === 'number' ? e.clientY : lastDragClientY;
            var dragCandidateHeight = startHeight + (startY - lastDragClientY);
            var snappedHeight = findNearestSnapHeight(dragCandidateHeight, activePanel || getActivePanelElement());
            applyHeight(snappedHeight, true, activePanel);

            activeHandle = null;
            activePanel = null;
        });

        window.addEventListener('resize', function() {
            var activePanelEl = getActivePanelElement();
            if (!activePanelEl || !activePanelEl.classList.contains('panel-open')) {
                return;
            }
            var current = 0;
            if (typeof window.getDockPanelHeight === 'function') {
                current = parseFloat(window.getDockPanelHeight() || '0');
            }
            if (isFinite(current) && current > 0) {
                applyHeight(Math.min(current, computeMaxOpenHeight()), false, activePanelEl);
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initResizer);
    } else {
        initResizer();
    }
})();
