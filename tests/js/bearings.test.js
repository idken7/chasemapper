const { loadScript } = require('./helpers/loadScript');

// bearings.js calls $("#bearing_plot").click(...) at load time (top-level,
// not inside a function) and bearingValid() calls utils.js's
// getCheckboxState() - load real jQuery and utils.js first so both work.
global.$ = global.jQuery = require('jquery');
global.L = { icon: (opts) => ({ __leafletIcon: true, ...opts }) };
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
