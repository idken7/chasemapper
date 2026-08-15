const { loadScript } = require('./helpers/loadScript');

// cesium-map.js's IIFE only *declares* functions at load time (no top-level
// calls into Cesium/jQuery/the map) - it loads cleanly with no extra stubs.
// The functions under test here (isCesiumActive, applyCesiumMapViewState's
// callers etc.) don't touch the real Cesium/Leaflet globals, so none are
// needed for what's covered below.
loadScript('cesium-map.js');

describe('isCesiumActive', () => {
  beforeEach(() => {
    // cesiumState is module-private and persists across tests in this file
    // (loadScript only runs once) - reset it explicitly rather than relying
    // on test declaration order.
    applyCesiumMapViewState(false);
  });

  test('starts inactive', () => {
    expect(isCesiumActive()).toBe(false);
  });

  test('reflects state after applyCesiumMapViewState(true/false) - the real Leaflet/Cesium toggle path', () => {
    // applyCesiumMapViewState(active) sets cesiumState.active unconditionally
    // before it ever touches the real Cesium global (it bails out right after
    // via hasCesium(), which is exactly what makes this safely callable here
    // without a real Cesium.Viewer) - this is the actual code path the app's
    // 2D/3D toggle button drives, not module-private state reached into directly.
    applyCesiumMapViewState(true);
    expect(isCesiumActive()).toBe(true);

    applyCesiumMapViewState(false);
    expect(isCesiumActive()).toBe(false);
  });

  test('is exported on window, matching how balloon.js/predictions.js call it', () => {
    // balloon.js/predictions.js guard their expensive path-copy with
    // `typeof isCesiumActive !== 'function' || isCesiumActive()` - this only
    // protects them if the export actually exists.
    expect(typeof window.isCesiumActive).toBe('function');
    expect(window.isCesiumActive).toBe(isCesiumActive);
  });

  test('returns a real boolean, not a truthy/falsy non-boolean', () => {
    // The !! coercion in isCesiumActive's implementation matters: callers
    // do strict-ish truthiness checks and the function is documented to
    // return a boolean.
    expect(isCesiumActive()).toBe(false);
    expect(typeof isCesiumActive()).toBe('boolean');
  });
});
