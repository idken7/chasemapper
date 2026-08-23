const { loadScript } = require('./helpers/loadScript');

// bearings.js calls $("#bearing_plot").click(...) at load time (top-level,
// not inside a function) and bearingValid() calls utils.js's
// getCheckboxState() - load real jQuery and utils.js first so both work.
global.$ = global.jQuery = require('jquery');

// addBearing/redrawBearings/removeBearings render via
// window.syncBearingLineOnCesium/removeBearingLineOnCesium (see
// cesium-map.js) rather than touching a map library directly - stub those
// so these tests stay about bearings.js's own logic.
global.syncBearingLineOnCesium = jest.fn();
global.removeBearingLineOnCesium = jest.fn();

loadScript('utils.js');
loadScript('bearings.js');

describe('bearingSourceElementId', () => {
  test('sanitizes special characters (jQuery ID selector syntax) out of a free-text source name', () => {
    // Sources can now be free-text names like "EasyBearing: VK5QI" (see
    // add_manual_bearing) - ':' and other punctuation would otherwise break
    // $("#" + id) selector lookups.
    expect(bearingSourceElementId('EasyBearing: VK5QI')).toBe('bearing_source_EasyBearing__VK5QI');
  });

  test('leaves an already-safe source name untouched', () => {
    expect(bearingSourceElementId('kraken-sdr')).toBe('bearing_source_kraken-sdr');
  });

  test('handles empty/null/undefined source without throwing', () => {
    expect(bearingSourceElementId('')).toBe('bearing_source_');
    expect(bearingSourceElementId(null)).toBe('bearing_source_');
    expect(bearingSourceElementId(undefined)).toBe('bearing_source_');
  });
});

describe('getBearingLineColour', () => {
  beforeEach(() => {
    // Module-level state (persists across tests since loadScript only runs
    // once) - reset it explicitly so each test starts from "no source seen yet".
    window.bearing_primary_source = null;
    window.bearing_source_colours = {};
    window.bearing_source_colour_idx = 0;
    window.bearing_color = '#000000';
  });

  test('the first source seen becomes primary and keeps the configured bearing_color', () => {
    expect(getBearingLineColour('yagi-1')).toBe('#000000');
    // Still primary on a later call, even after other sources appear.
    getBearingLineColour('yagi-2');
    expect(getBearingLineColour('yagi-1')).toBe('#000000');
  });

  test('a second, distinct source gets a palette colour, not the primary bearing_color', () => {
    getBearingLineColour('yagi-1'); // establishes yagi-1 as primary
    const secondColour = getBearingLineColour('yagi-2');
    expect(secondColour).not.toBe('#000000');
    expect(secondColour).toBe('#e74c3c'); // first palette entry
  });

  test('each distinct non-primary source gets a stable, distinct palette colour', () => {
    getBearingLineColour('primary');
    const a1 = getBearingLineColour('sourceA');
    const b1 = getBearingLineColour('sourceB');
    const a2 = getBearingLineColour('sourceA'); // same source again -> same colour, not re-advanced

    expect(a1).not.toBe(b1);
    expect(a1).toBe(a2);
  });
});

describe('bearingValid', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.bearing_confidence_threshold = 5.0;
  });

  test('rejects a bearing at or below the confidence threshold', () => {
    expect(bearingValid({ confidence: 5.0, heading_valid: true, source: 'x' })).toBe(false);
    expect(bearingValid({ confidence: 2.0, heading_valid: true, source: 'x' })).toBe(false);
  });

  test('accepts a bearing above the confidence threshold with a valid heading', () => {
    expect(bearingValid({ confidence: 10.0, heading_valid: true, source: 'x' })).toBe(true);
  });

  test('rejects a bearing with an invalid heading unless showStationaryBearings is checked', () => {
    const bearing = { confidence: 10.0, heading_valid: false, source: 'x' };

    // No #showStationaryBearings checkbox present -> getCheckboxState defaults to false.
    expect(bearingValid(bearing)).toBe(false);

    document.body.innerHTML = '<input type="checkbox" id="showStationaryBearings" checked>';
    expect(bearingValid(bearing)).toBe(true);
  });

  test('rejects an otherwise-valid bearing when its source filter checkbox is unchecked', () => {
    const bearing = { confidence: 10.0, heading_valid: true, source: 'yagi-1' };
    document.body.innerHTML = '<input type="checkbox" id="bearing_source_yagi-1">'; // unchecked

    expect(bearingValid(bearing)).toBe(false);
  });

  test('accepts the bearing when its source filter checkbox is present and checked', () => {
    const bearing = { confidence: 10.0, heading_valid: true, source: 'yagi-1' };
    document.body.innerHTML = '<input type="checkbox" id="bearing_source_yagi-1" checked>';

    expect(bearingValid(bearing)).toBe(true);
  });

  test('a source with special characters still resolves to its filter checkbox correctly', () => {
    // Exercises bearingValid -> bearingSourceElementId integration for the
    // free-text "EasyBearing: NAME" source format.
    const bearing = { confidence: 10.0, heading_valid: true, source: 'EasyBearing: VK5QI' };
    document.body.innerHTML = '<input type="checkbox" id="bearing_source_EasyBearing__VK5QI">'; // unchecked

    expect(bearingValid(bearing)).toBe(false);
  });
});

describe('calculateBearingOpacity', () => {
  beforeEach(() => {
    window.latest_server_timestamp = 1000;
    window.bearing_max_age = 100;
    window.bearing_max_opacity = 0.8;
    window.bearing_min_opacity = 0.1;
  });

  test('a bearing timestamped after the latest known server time gets max opacity', () => {
    expect(calculateBearingOpacity(1001)).toBe(0.8);
  });

  test('a bearing older than bearing_max_age is fully transparent', () => {
    expect(calculateBearingOpacity(1000 - 101)).toBe(0.0);
  });

  test('opacity fades linearly with age between max and min', () => {
    // Half-way through bearing_max_age -> half-way between max and min opacity.
    const _opacity = calculateBearingOpacity(1000 - 50);
    expect(_opacity).toBeCloseTo(0.8 - 50 / 100, 5);
  });

  test('opacity is floored at bearing_min_opacity, never goes below it', () => {
    // Close to bearing_max_age but not over it - the raw linear formula
    // would dip under bearing_min_opacity here without the floor.
    const _opacity = calculateBearingOpacity(1000 - 99);
    expect(_opacity).toBe(0.1);
  });
});

describe('getActiveDoaSources', () => {
  beforeEach(() => {
    window.bearing_store = {};
    window.latest_server_timestamp = 1000;
    window.doa_panel_stale_after_s = 120;
    window.doa_panel_max_sources = 6;
    window.bearing_primary_source = null;
    window.bearing_source_colours = {};
    window.bearing_source_colour_idx = 0;
  });

  test('returns only the latest bearing per source', () => {
    window.bearing_store = {
      '900': { source: 'a', true_bearing: 10, confidence: 90, power: -30 },
      '950': { source: 'a', true_bearing: 20, confidence: 95, power: -25 },
    };

    const _active = getActiveDoaSources();
    expect(_active).toHaveLength(1);
    expect(_active[0].bearing).toBe(20); // the newer of the two 'a' entries
  });

  test('excludes sources not heard from within doa_panel_stale_after_s', () => {
    window.bearing_store = {
      '850': { source: 'stale', true_bearing: 5, confidence: 90, power: -30 }, // 150s old
      '950': { source: 'fresh', true_bearing: 5, confidence: 90, power: -30 }, // 50s old
    };

    const _sources = getActiveDoaSources().map((s) => s.source);
    expect(_sources).toEqual(['fresh']);
  });

  test('sorts newest-first and caps at doa_panel_max_sources', () => {
    window.doa_panel_max_sources = 2;
    window.bearing_store = {
      '910': { source: 'oldest', true_bearing: 1, confidence: 90, power: -30 },
      '950': { source: 'middle', true_bearing: 2, confidence: 90, power: -30 },
      '990': { source: 'newest', true_bearing: 3, confidence: 90, power: -30 },
    };

    const _sources = getActiveDoaSources().map((s) => s.source);
    expect(_sources).toEqual(['newest', 'middle']);
  });
});

describe('renderDoaPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="doaBearingPanel"></div>';
    window.bearing_store = {};
    window.latest_server_timestamp = 1000;
    window.doa_panel_stale_after_s = 120;
    window.doa_panel_max_sources = 6;
    window.bearing_primary_source = null;
    window.bearing_source_colours = {};
    window.bearing_source_colour_idx = 0;
  });

  test('does nothing when the panel element is absent from the page', () => {
    document.body.innerHTML = '';
    expect(() => renderDoaPanel()).not.toThrow();
  });

  test('renders the empty state with no active sources', () => {
    renderDoaPanel();
    const $panel = $('#doaBearingPanel');

    expect($panel.hasClass('doa-panel-empty-state')).toBe(true);
    expect($panel.html()).toContain('No bearings yet');
    expect($panel.html()).toContain('0 SOURCES');
    // BRG/CONF/PWR stats fall back to an em-dash when there's no primary source.
    expect($panel.find('.doa-stat-value--accent').text()).toContain('—');
  });

  test('renders the primary source stats and a legend row per active source', () => {
    window.bearing_store = {
      '950': { source: 'yagi-1', true_bearing: 123.4, confidence: 87, power: -42 },
      '960': { source: 'yagi-2', true_bearing: 45.0, confidence: 60, power: -50 },
    };

    renderDoaPanel();
    const $panel = $('#doaBearingPanel');

    expect($panel.hasClass('doa-panel-empty-state')).toBe(false);
    expect($panel.html()).toContain('2 SOURCES');
    // The most recently-heard source (timestamp 960 = yagi-2) is primary.
    expect($panel.find('.doa-stat-value--accent').text()).toContain('45');
    expect($panel.find('.doa-legend-item')).toHaveLength(2);
  });
});

describe('addBearing / removeBearings / bearingUpdate', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="bearing_source_selector"></div><div id="doaBearingPanel"></div><div id="bearing_plot"></div>';
    window.bearing_store = {};
    window.bearing_sources = [];
    window.bearing_length = 10000;
    window.bearing_weight = 1.0;
    window.manual_bearing_weight = 5.0;
    window.bearing_confidence_threshold = 5.0;
    window.timeSeqEnabled = false;
    syncBearingLineOnCesium.mockClear();
    removeBearingLineOnCesium.mockClear();
  });

  function basicBearing(overrides) {
    return Object.assign({
      lat: -35.0,
      lon: 138.0,
      true_bearing: 90.0,
      confidence: 80.0,
      heading_valid: true,
      source: 'yagi-1',
    }, overrides);
  }

  test('stores the bearing, draws a polyline, and adds a source filter checkbox', () => {
    addBearing('100.00', basicBearing(), false);

    expect(bearing_store['100.00'].source).toBe('yagi-1');
    expect(syncBearingLineOnCesium).toHaveBeenCalledTimes(1);
    expect(syncBearingLineOnCesium.mock.calls[0][0]).toBe('100.00');

    expect(bearing_sources).toContain('yagi-1');
    expect($('#' + bearingSourceElementId('yagi-1')).length).toBe(1);
    expect($('#' + bearingSourceElementId('yagi-1')).prop('checked')).toBe(true);
  });

  test('a manual-bearing source (matching manual_bearing_sources) gets the thicker manual weight', () => {
    addBearing('100.00', basicBearing({ source: 'EasyBearing: VK5QI' }), false);

    const _weight = syncBearingLineOnCesium.mock.calls[0][3];
    expect(_weight).toBe(manual_bearing_weight);
  });

  test('a non-manual source gets the regular bearing weight', () => {
    addBearing('100.00', basicBearing({ source: 'yagi-1' }), false);

    const _weight = syncBearingLineOnCesium.mock.calls[0][3];
    expect(_weight).toBe(bearing_weight);
  });

  test('does not add the line to the map when the bearing is below the confidence threshold', () => {
    addBearing('100.00', basicBearing({ confidence: 1.0 }), false);

    expect(syncBearingLineOnCesium).not.toHaveBeenCalled();
  });

  test('strips raw_bearing_angles/raw_doa off the stored bearing (kept transient, not persisted)', () => {
    addBearing('100.00', basicBearing({ raw_bearing_angles: [0, 90], raw_doa: [1, 2] }), false);

    expect(bearing_store['100.00']).not.toHaveProperty('raw_bearing_angles');
    expect(bearing_store['100.00']).not.toHaveProperty('raw_doa');
  });

  test('removeBearings deletes the entry and removes its line from the map', () => {
    addBearing('100.00', basicBearing(), false);

    removeBearings(['100.00']);

    expect(bearing_store).not.toHaveProperty('100.00');
    expect(removeBearingLineOnCesium).toHaveBeenCalledWith('100.00');
  });

  test('removeBearings silently ignores timestamps not present in the store', () => {
    expect(() => removeBearings(['does-not-exist'])).not.toThrow();
  });

  test('bearingUpdate removes stale entries and adds the new one in a single call', () => {
    addBearing('100.00', basicBearing(), false);

    bearingUpdate({
      remove: ['100.00'],
      add: Object.assign({ key: '200.00' }, basicBearing({ source: 'yagi-2' })),
    });

    expect(bearing_store).not.toHaveProperty('100.00');
    expect(removeBearingLineOnCesium).toHaveBeenCalledWith('100.00');
    expect(bearing_store['200.00'].source).toBe('yagi-2');
  });
});

describe('doaFormatBearing', () => {
  test('zero-pads to three digits', () => {
    expect(doaFormatBearing(0)).toBe('000&deg;');
    expect(doaFormatBearing(42)).toBe('042&deg;');
    expect(doaFormatBearing(317.6)).toBe('318&deg;');
  });

  test('wraps negative and over-360 values into 0-359', () => {
    expect(doaFormatBearing(-10)).toBe('350&deg;');
    expect(doaFormatBearing(370)).toBe('010&deg;');
  });
});

describe('doaTabNeedsLocationWarning', () => {
  beforeEach(() => {
    window.chase_car_position = { latest_data: [], heading: 0 };
    window.my_device_position_active = false;
  });

  test('the Readings tab never needs the warning', () => {
    expect(doaTabNeedsLocationWarning('readings')).toBe(false);
  });

  test('EasyBearing warns when the chase car has no known position yet', () => {
    expect(doaTabNeedsLocationWarning('easybearing')).toBe(true);
    window.chase_car_position.latest_data = [-35.0, 138.0];
    expect(doaTabNeedsLocationWarning('easybearing')).toBe(false);
  });

  test("O'Clock warns based on my_device_position_active, not the chase car position", () => {
    // Car position is known, but *this browser* isn't sharing its own
    // location yet - relative bearings fuse with the submitter's own
    // tracked position server-side, so that's the gate that matters here.
    window.chase_car_position.latest_data = [-35.0, 138.0];
    expect(doaTabNeedsLocationWarning('oclock')).toBe(true);
    window.my_device_position_active = true;
    expect(doaTabNeedsLocationWarning('oclock')).toBe(false);
  });
});

describe('DOA panel tabs', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="doaBearingPanel"></div>';
    window.bearing_store = {};
    window.latest_server_timestamp = 1000;
    window.doa_panel_stale_after_s = 120;
    window.doa_panel_max_sources = 6;
    window.bearing_primary_source = null;
    window.bearing_source_colours = {};
    window.bearing_source_colour_idx = 0;
    window.doa_panel_active_tab = 'readings';
    window.doa_panel_built_tab = null;
    window.doa_panel_built_warning = false;
    window.chase_car_position = { latest_data: [-35.0, 138.0], heading: 90 };
    window.my_device_position_active = true;
    window.timeSeqEnabled = false;
  });

  test('defaults to the Readings tab, marked active in the tab strip', () => {
    renderDoaPanel();
    const $panel = $('#doaBearingPanel');

    expect($panel.find('.doa-tab-btn[data-doa-tab="readings"]').hasClass('is-active')).toBe(true);
    expect($panel.find('.doa-panel-compass-wrap').length).toBe(1);
  });

  test('clicking a tab swaps the panel content in place', () => {
    renderDoaPanel();
    $('#doaBearingPanel').find('.doa-tab-btn[data-doa-tab="easybearing"]').trigger('click');

    const $panel = $('#doaBearingPanel');
    expect(doa_panel_active_tab).toBe('easybearing');
    expect($panel.find('.doa-tab-btn[data-doa-tab="easybearing"]').hasClass('is-active')).toBe(true);
    expect($panel.find('#doaEbDialWrap').length).toBe(1);
    expect($panel.find('.doa-panel-compass-wrap').length).toBe(0);
  });

  test('a bearing_store change while on EasyBearing does not rebuild the tab (would drop an in-progress drag)', () => {
    renderDoaPanel();
    $('#doaBearingPanel').find('.doa-tab-btn[data-doa-tab="easybearing"]').trigger('click');
    const _dialNode = document.getElementById('doaEbDialWrap');

    // Simulates the renderDoaPanel() call addBearing() makes when a new
    // bearing_change event arrives, e.g. from getActiveDoaSources()'s
    // Readings-only data changing underneath an open EasyBearing tab.
    window.bearing_store = { 950: { source: 'yagi-1', true_bearing: 12, confidence: 90, power: -30 } };
    renderDoaPanel();

    expect(document.getElementById('doaEbDialWrap')).toBe(_dialNode);
  });

  test('switching to EasyBearing without a known chase car position shows the location warning instead of the dial', () => {
    window.chase_car_position.latest_data = [];
    renderDoaPanel();
    $('#doaBearingPanel').find('.doa-tab-btn[data-doa-tab="easybearing"]').trigger('click');

    const $panel = $('#doaBearingPanel');
    expect($panel.find('.doa-warning-box').length).toBe(1);
    expect($panel.find('#doaEbDialWrap').length).toBe(0);
  });

  test('the warning clears itself once a known position appears, without a tab click', () => {
    window.chase_car_position.latest_data = [];
    renderDoaPanel();
    $('#doaBearingPanel').find('.doa-tab-btn[data-doa-tab="easybearing"]').trigger('click');
    expect($('#doaBearingPanel').find('.doa-warning-box').length).toBe(1);

    // e.g. the car's GPS fixes a moment later - the periodic renderDoaPanel()
    // tick (see the 1s setInterval in bearings.js) should notice the warning
    // condition flipped and rebuild, even though the active tab didn't change.
    window.chase_car_position.latest_data = [-35.0, 138.0];
    renderDoaPanel();

    const $panel = $('#doaBearingPanel');
    expect($panel.find('.doa-warning-box').length).toBe(0);
    expect($panel.find('#doaEbDialWrap').length).toBe(1);
  });
});

describe('EasyBearing dial', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="doaBearingPanel"></div>';
    window.bearing_store = {};
    window.latest_server_timestamp = 1000;
    window.doa_panel_active_tab = 'easybearing';
    window.doa_panel_built_tab = null;
    window.doa_panel_built_warning = false;
    window.chase_car_position = { latest_data: [-35.0, 138.0], heading: 90 };
    window.my_car_client_id = 'client-1';
    window.getMyCarName = () => 'VK5QI';
    window.socket = { emit: jest.fn() };
    window.showAppToast = jest.fn();
    window.doa_eb_bearing = 0;
    renderDoaPanel();
  });

  test('nudge buttons adjust the bearing and wrap around 0/360', () => {
    $('.doa-eb-nudge-btn[data-delta="-10"]').trigger('click');

    expect(doa_eb_bearing).toBe(350);
    expect($('#doaEbDialReadout').text()).toBe('350°');
  });

  test('Send Bearing emits an absolute bearing anchored at the chase car position', () => {
    setDoaEbBearing(123);
    $('#doaEbSendBtn').trigger('click');

    expect(socket.emit).toHaveBeenCalledWith('add_manual_bearing', expect.objectContaining({
      bearing_type: 'absolute',
      source: 'EasyBearing',
      bearing: 123,
      latitude: -35.0,
      longitude: 138.0,
      client_id: 'client-1',
      name: 'VK5QI',
    }));
  });
});

describe("O'Clock ring", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="doaBearingPanel"></div>';
    window.bearing_store = {};
    window.latest_server_timestamp = 1000;
    window.doa_panel_active_tab = 'oclock';
    window.doa_panel_built_tab = null;
    window.doa_panel_built_warning = false;
    window.chase_car_position = { latest_data: [-35.0, 138.0], heading: 90 };
    window.my_device_position_active = true;
    window.my_car_client_id = 'client-1';
    window.getMyCarName = () => 'VK5QI';
    window.socket = { emit: jest.fn() };
    window.timeSeqEnabled = false;
    window.doa_oclock_last_value = null;
    window.doa_oclock_last_clock = null;
    window.doa_oclock_last_time = null;
    renderDoaPanel();
  });

  test('renders 12 clock positions at 30-degree increments, with 12 o\'clock as 0 degrees', () => {
    expect($('.doa-oclock-btn').length).toBe(12);
    expect($('.doa-oclock-btn[data-clock="12"]').attr('data-bearing')).toBe('0');
    expect($('.doa-oclock-btn[data-clock="3"]').attr('data-bearing')).toBe('90');
    expect($('.doa-oclock-btn[data-clock="6"]').attr('data-bearing')).toBe('180');
  });

  test('clicking a clock position emits a relative bearing and updates the last-sent readout', () => {
    $('.doa-oclock-btn[data-clock="6"]').trigger('click');

    expect(socket.emit).toHaveBeenCalledWith('add_manual_bearing', expect.objectContaining({
      bearing_type: 'relative',
      source: 'EasyBearing',
      bearing: 180,
      client_id: 'client-1',
      name: 'VK5QI',
    }));
    expect($('#doaOclockLastValue').text()).toBe("180° (6 o'clock)");
    expect($('#doaOclockLast')[0].style.display).not.toBe('none');
  });
});
