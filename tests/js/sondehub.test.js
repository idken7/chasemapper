const { loadScript } = require('./helpers/loadScript');

// sondehub.js uses $.each (jQuery) - install the real library against jsdom's
// window rather than hand-rolling a stub, so $.each's real iteration
// semantics (including safely deleting the current key mid-iteration, which
// pruneStaleChaseVehicles relies on) are exercised faithfully.
//
// Under jsdom, `global.document` already exists by the time this require()
// runs, so jQuery's UMD wrapper takes the "already in a browser" branch and
// exports the ready-made jQuery object directly - NOT a `window => jQuery`
// factory (that factory form only appears when jQuery is loaded in a
// documentless environment, e.g. plain Node). Calling it as a factory here
// (`require('jquery')(window)`) would instead invoke jQuery itself as a
// constructor on `window`, silently producing a jQuery-wrapped-window
// collection instead of the library.
global.$ = global.jQuery = require('jquery');

// sondehub.js schedules `window.setInterval(pruneStaleChaseVehicles, 60000)`
// at load time (top-level, not inside a function) - use fake timers so
// loading the script under test doesn't leave a real repeating interval
// running for the lifetime of the test process.
jest.useFakeTimers();
loadScript('sondehub.js');

describe('pruneStaleChaseVehicles', () => {
  beforeEach(() => {
    global.chase_vehicles = {};
  });

  test('removes a vehicle whose last_seen is older than the staleness threshold', () => {
    const marker = { remove: jest.fn() };
    chase_vehicles['VK5QI-9'] = {
      marker,
      last_seen: Date.now() - (CHASE_VEHICLE_STALE_MS + 1000),
    };

    pruneStaleChaseVehicles();

    expect(chase_vehicles).not.toHaveProperty('VK5QI-9');
    expect(marker.remove).toHaveBeenCalledTimes(1);
  });

  test('leaves a recently-seen vehicle alone', () => {
    const marker = { remove: jest.fn() };
    chase_vehicles['VK5QI-9'] = {
      marker,
      last_seen: Date.now() - 1000, // 1s ago, well under the 15-minute threshold
    };

    pruneStaleChaseVehicles();

    expect(chase_vehicles).toHaveProperty('VK5QI-9');
    expect(marker.remove).not.toHaveBeenCalled();
  });

  test('leaves a vehicle with no last_seen alone (never marks it stale)', () => {
    // Defensive: a vehicle entry somehow missing last_seen shouldn't be
    // treated as "infinitely old" and removed.
    chase_vehicles['NOTIME'] = { marker: { remove: jest.fn() } };

    pruneStaleChaseVehicles();

    expect(chase_vehicles).toHaveProperty('NOTIME');
  });

  test('prunes multiple stale vehicles in one pass and leaves fresh ones', () => {
    const staleMarkerA = { remove: jest.fn() };
    const staleMarkerB = { remove: jest.fn() };
    const freshMarker = { remove: jest.fn() };

    chase_vehicles['STALE-A'] = { marker: staleMarkerA, last_seen: Date.now() - (CHASE_VEHICLE_STALE_MS + 5000) };
    chase_vehicles['STALE-B'] = { marker: staleMarkerB, last_seen: Date.now() - (CHASE_VEHICLE_STALE_MS + 60000) };
    chase_vehicles['FRESH'] = { marker: freshMarker, last_seen: Date.now() };

    pruneStaleChaseVehicles();

    expect(Object.keys(chase_vehicles)).toEqual(['FRESH']);
    expect(staleMarkerA.remove).toHaveBeenCalledTimes(1);
    expect(staleMarkerB.remove).toHaveBeenCalledTimes(1);
    expect(freshMarker.remove).not.toHaveBeenCalled();
  });

  test('does not throw when a stale vehicle has no marker', () => {
    chase_vehicles['NOMARKER'] = { last_seen: Date.now() - (CHASE_VEHICLE_STALE_MS + 1000) };
    expect(() => pruneStaleChaseVehicles()).not.toThrow();
    expect(chase_vehicles).not.toHaveProperty('NOMARKER');
  });

  test('is wired up to run automatically on a 60s interval', () => {
    const marker = { remove: jest.fn() };
    chase_vehicles['VK5QI-9'] = {
      marker,
      last_seen: Date.now() - (CHASE_VEHICLE_STALE_MS + 1000),
    };

    // Nothing has pruned it yet - the interval hasn't fired.
    expect(chase_vehicles).toHaveProperty('VK5QI-9');

    jest.advanceTimersByTime(60000);

    expect(chase_vehicles).not.toHaveProperty('VK5QI-9');
  });
});
