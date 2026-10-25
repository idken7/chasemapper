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

describe('getStored2DMode', () => {
  afterEach(() => {
    localStorage.clear();
  });

  test('is exported on window, matching how settings.js/index.html call it', () => {
    // settings.js and index.html guard the persisted-mode restore with
    // `typeof getStored2DMode === 'function' && getStored2DMode()` - this
    // only protects them if the export actually exists.
    expect(typeof window.getStored2DMode).toBe('function');
    expect(window.getStored2DMode).toBe(getStored2DMode);
  });

  test('reflects the value persisted by set2DMode/set3DMode across a reload', () => {
    set2DMode();
    expect(getStored2DMode()).toBe(true);

    set3DMode();
    expect(getStored2DMode()).toBe(false);
  });
});

describe('setCesiumCameraPitch', () => {
  test('is exported on window, matching how the camera-angle slider calls it', () => {
    expect(typeof window.setCesiumCameraPitch).toBe('function');
    expect(typeof window.getCesiumCameraState).toBe('function');
  });

  test('updates the stored pitch and returns it', () => {
    expect(setCesiumCameraPitch(-25)).toBe(-25);
    expect(getCesiumCameraState().pitch).toBe(-25);
  });

  test('clamps to the allowed range instead of storing an out-of-range pitch', () => {
    expect(setCesiumCameraPitch(10)).toBe(-5);
    expect(setCesiumCameraPitch(-120)).toBe(-89);
  });

  test('works with no viewer yet (cancelling camera motion must not throw before Cesium loads)', () => {
    applyCesiumMapViewState(false);
    expect(() => setCesiumCameraPitch(-40)).not.toThrow();
    expect(getCesiumCameraState().pitch).toBe(-40);
  });
});
