const { loadScript } = require('./helpers/loadScript');

// utils.js builds a handful of icon lookup tables at load time via L.icon(...)
// (top-level for-loops, not inside a function) - stub just enough of the
// Leaflet API for that to run without needing the real library.
global.L = {
  icon: (opts) => ({ __leafletIcon: true, ...opts }),
};

loadScript('utils.js');

describe('getCheckboxState', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('returns the checked state of an existing checkbox', () => {
    document.body.innerHTML = '<input type="checkbox" id="myBox" checked>';
    expect(getCheckboxState('myBox', false)).toBe(true);
  });

  test('returns false for an unchecked existing checkbox', () => {
    document.body.innerHTML = '<input type="checkbox" id="myBox">';
    expect(getCheckboxState('myBox', true)).toBe(false);
  });

  test('falls back to the given default when the element is absent, instead of throwing', () => {
    // Several settings toggles were removed from the UI during refactors
    // while code still reads their state - this must not throw
    // "Cannot read properties of null".
    expect(getCheckboxState('doesNotExist', true)).toBe(true);
    expect(getCheckboxState('doesNotExist', false)).toBe(false);
  });

  test('defaults the default itself to false when omitted', () => {
    expect(getCheckboxState('doesNotExist')).toBe(false);
  });
});

describe('escapeHtml', () => {
  test('escapes all five special characters', () => {
    expect(escapeHtml(`<script>alert("x")&'y'</script>`)).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&amp;&#39;y&#39;&lt;/script&gt;'
    );
  });

  test('handles null/undefined/empty input without throwing', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml('')).toBe('');
  });

  test('passes through a string with nothing to escape unchanged', () => {
    expect(escapeHtml('VK5QI-9')).toBe('VK5QI-9');
  });
});

describe('calculate_lookangles', () => {
  test('elevation is ~0 for two points at the same altitude and a large horizontal separation', () => {
    const a = { lat: 0, lon: 0, alt: 0 };
    const b = { lat: 0, lon: 1, alt: 0 };
    const info = calculate_lookangles(a, b);
    expect(info.elevation).toBeCloseTo(0, 0);
    expect(info.range).toBeGreaterThan(0);
  });

  test('elevation is close to 90 degrees for a point almost directly overhead', () => {
    const a = { lat: 0, lon: 0, alt: 0 };
    const b = { lat: 0.0001, lon: 0, alt: 30000 };
    const info = calculate_lookangles(a, b);
    expect(info.elevation).toBeGreaterThan(80);
  });

  test('bearing string reflects an eastward, northern-hemisphere-style target', () => {
    const a = { lat: 0, lon: 0, alt: 0 };
    const b = { lat: 0, lon: 1, alt: 0 };
    const info = calculate_lookangles(a, b);
    expect(info.bearing).toContain('E');
  });
});

describe('addBoundedLatLng', () => {
  // Fake Leaflet polyline: just enough of the real API surface
  // (addLatLng/getLatLngs/setLatLngs) for addBoundedLatLng to drive, without
  // pulling in the whole Leaflet rendering stack for what's really a plain
  // array-management test.
  function makeFakePolyline(initial = []) {
    let points = [...initial];
    return {
      addLatLng: (p) => { points.push(p); },
      getLatLngs: () => points,
      setLatLngs: (newPoints) => { points = [...newPoints]; },
    };
  }

  test('appends points normally while under the cap', () => {
    const poly = makeFakePolyline();
    for (let i = 0; i < 10; i++) {
      addBoundedLatLng(poly, [i, i], 100, 10);
    }
    expect(poly.getLatLngs()).toHaveLength(10);
    expect(poly.getLatLngs()[9]).toEqual([9, 9]);
  });

  test('does not trim until maxPoints + overshoot is exceeded (batches the O(n) rebuild)', () => {
    const poly = makeFakePolyline();
    // maxPoints=10, overshoot=5 -> trimming only kicks in once length > 15
    for (let i = 0; i < 15; i++) {
      addBoundedLatLng(poly, [i, i], 10, 5);
    }
    expect(poly.getLatLngs()).toHaveLength(15); // still untrimmed at exactly the threshold

    addBoundedLatLng(poly, [15, 15], 10, 5); // 16th point crosses the threshold
    expect(poly.getLatLngs()).toHaveLength(10); // trimmed back down to maxPoints
  });

  test('trimming keeps the most recent points and drops the oldest', () => {
    const poly = makeFakePolyline();
    // maxPoints=5, overshoot=2 -> trim triggers once length > 7, i.e. on the
    // 8th append (index 7), trimming back down to the most recent 5.
    for (let i = 0; i < 8; i++) {
      addBoundedLatLng(poly, [i, i], 5, 2);
    }
    const latlngs = poly.getLatLngs();
    expect(latlngs).toHaveLength(5);
    // Points 0..2 must be gone; the most recent (3..7) must remain, in order.
    expect(latlngs).toEqual([[3, 3], [4, 4], [5, 5], [6, 6], [7, 7]]);
  });

  test('uses sane defaults (8000 cap) when maxPoints/overshoot are omitted', () => {
    const poly = makeFakePolyline();
    for (let i = 0; i < 100; i++) {
      addBoundedLatLng(poly, [i, i]);
    }
    // Far under the 8000 default cap - nothing should have been trimmed.
    expect(poly.getLatLngs()).toHaveLength(100);
  });
});
