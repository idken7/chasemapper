const { loadScript } = require('./helpers/loadScript');

// chase_routing.js schedules a real setInterval poller at load time (looking
// for the Leaflet map to appear) - fake timers stop that from actually
// ticking during tests. This doesn't affect Promise/microtask scheduling
// (fetchOsrmRoute's .then() chains), which is native and untouched by fake
// timers, so no special handling is needed to await those below.
jest.useFakeTimers();

global.$ = global.jQuery = require('jquery');
// fetchOsrmRoute/applyFetchedRoute only need L.polyline(...).addTo(map) - a
// minimal stub keeps this test about the sequencing logic, not Leaflet.
global.L = { polyline: jest.fn(() => ({ addTo: jest.fn(() => ({})) })) };

loadScript('chase_routing.js');

// Resolves after a handful of real microtask ticks, enough to drain the
// multi-level .then() chains in fetchOsrmRoute/applyFetchedRoute. Plain
// Promise microtask scheduling is unaffected by jest.useFakeTimers() (which
// only fakes macrotask-style timer APIs), so this works without touching timers.
function flushMicrotasks(times = 10) {
  return new Promise((resolve) => {
    let i = 0;
    (function tick() {
      if (i++ >= times) { resolve(); return; }
      Promise.resolve().then(tick);
    })();
  });
}

function backendRouteBody(coordinates, distance_m = 100, duration_s = 60) {
  return {
    feature: { type: 'Feature', geometry: { type: 'LineString', coordinates } },
    distance_m,
    duration_s,
  };
}

// The direct-OSRM fallback response shape is different from the backend's:
// applyFetchedRoute receives j.routes[0] verbatim (a flat {geometry, distance,
// duration} object), not the backend's {feature: {geometry}, distance_m, duration_s}.
function osrmRoute(coordinates, distance = 100, duration = 60) {
  return { geometry: { type: 'LineString', coordinates }, distance, duration };
}

function jsonResponse(body) {
  return { ok: true, json: () => Promise.resolve(body) };
}

describe('fetchOsrmRoute', () => {
  // A successful applyFetchedRoute() also fires its own fetch('/api/latest_route', ...)
  // (see pushLatestRouteToServer) interleaved with the /api/route calls under
  // test - track every fetch() call and pull specific ones out by URL rather
  // than assuming a fixed array index, since call order across these two
  // endpoints isn't otherwise meaningful to what's being tested here.
  let pendingFetches;

  function takeNextFetch(urlPredicate) {
    const idx = pendingFetches.findIndex((f) => urlPredicate(f.url));
    if (idx === -1) {
      throw new Error(
        'No matching pending fetch; pending URLs: ' + JSON.stringify(pendingFetches.map((f) => f.url))
      );
    }
    return pendingFetches.splice(idx, 1)[0];
  }

  function takeNextRouteFetch() {
    return takeNextFetch((url) => url === '/api/route');
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    window.map = { removeLayer: jest.fn() };
    window._displayChasePolyline = null;
    L.polyline.mockClear();

    pendingFetches = [];
    global.fetch = jest.fn((url) => {
      return new Promise((resolve, reject) => {
        pendingFetches.push({ url, resolve, reject });
      });
    });
  });

  test('a single successful backend route call draws the returned polyline', async () => {
    window.fetchOsrmRoute(39.0, -83.0, 39.2, -83.2);
    const call = takeNextRouteFetch();

    call.resolve(jsonResponse(backendRouteBody([[-83.0, 39.0], [-83.2, 39.2]])));
    await flushMicrotasks();

    expect(L.polyline).toHaveBeenCalledTimes(1);
    // applyFetchedRoute converts [lon,lat] pairs to Leaflet's [lat,lon] order.
    expect(L.polyline.mock.calls[0][0]).toEqual([[39.0, -83.0], [39.2, -83.2]]);
  });

  test('does nothing when window.map is not set up yet', () => {
    window.map = null;
    window.fetchOsrmRoute(39.0, -83.0, 39.2, -83.2);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('an older in-flight request resolving after a newer one does not overwrite the newer route', async () => {
    // Simulates a flaky-connection scenario: the first request is slow/retried
    // and still in flight when a second one starts (e.g. triggered by car
    // movement). Without the _routeFetchSeq guard this fixed, the older
    // response arriving second would silently clobber applyFetchedRoute()'s
    // state with stale data.
    window.fetchOsrmRoute(39.0, -83.0, 39.2, -83.2); // call 1 (older)
    const older = takeNextRouteFetch();
    window.fetchOsrmRoute(40.0, -84.0, 40.2, -84.2); // call 2 (newer, supersedes call 1)
    const newer = takeNextRouteFetch();

    // Newer request's response arrives (and is applied) first.
    newer.resolve(jsonResponse(backendRouteBody([[-84.0, 40.0], [-84.2, 40.2]])));
    await flushMicrotasks();

    expect(L.polyline).toHaveBeenCalledTimes(1);
    expect(L.polyline.mock.calls[0][0]).toEqual([[40.0, -84.0], [40.2, -84.2]]);

    // Older (stale) request's response arrives late - must be ignored entirely.
    older.resolve(jsonResponse(backendRouteBody([[-83.0, 39.0], [-83.2, 39.2]])));
    await flushMicrotasks();

    expect(L.polyline).toHaveBeenCalledTimes(1); // still just the one call, from call 2
  });

  test('a superseded call does not even attempt the OSRM fallback on backend failure', async () => {
    // Once a newer call exists, an older call's error handling is abandoned
    // entirely (the _seq check sits at the top of the .catch() handler,
    // before the fallback fetch is issued) - not just its success path.
    // Confirms the guard avoids wasted fallback network requests too, not
    // only wasted state overwrites.
    window.fetchOsrmRoute(1, 1, 2, 2); // call 1 (older) - will fail
    const older = takeNextRouteFetch();
    window.fetchOsrmRoute(3, 3, 4, 4); // call 2 (newer) - supersedes call 1

    older.reject(new Error('simulated backend failure'));
    await flushMicrotasks();

    // No OSRM-fallback fetch for the superseded call 1.
    expect(pendingFetches.some((f) => f.url.includes('router.project-osrm.org'))).toBe(false);
  });

  test('an in-flight (not yet superseded) call still falls back to OSRM on backend failure', async () => {
    // Expected noise: fetchOsrmRoute logs this via console.warn as part of
    // its normal fallback path, not an error in the test itself.
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    window.fetchOsrmRoute(1, 1, 2, 2);
    const call = takeNextRouteFetch();

    call.reject(new Error('simulated backend failure'));
    await flushMicrotasks();

    const fallback = takeNextFetch((url) => url.includes('router.project-osrm.org'));
    fallback.resolve(jsonResponse({ routes: [osrmRoute([[1, 1], [2, 2]])] }));
    await flushMicrotasks();

    expect(L.polyline).toHaveBeenCalledTimes(1);
    expect(L.polyline.mock.calls[0][0]).toEqual([[1, 1], [2, 2]]);
    warnSpy.mockRestore();
  });

  test('a lone request (no race) still applies normally through the sequencing guard', async () => {
    // Guards against a fix that's *too* aggressive (e.g. rejecting anything
    // but the very first call ever made, rather than only superseded ones).
    window.fetchOsrmRoute(10, 10, 11, 11);
    takeNextRouteFetch().resolve(jsonResponse(backendRouteBody([[10, 10], [11, 11]])));
    await flushMicrotasks();
    expect(L.polyline).toHaveBeenCalledTimes(1);

    window.fetchOsrmRoute(20, 20, 21, 21);
    takeNextRouteFetch().resolve(jsonResponse(backendRouteBody([[20, 20], [21, 21]])));
    await flushMicrotasks();
    expect(L.polyline).toHaveBeenCalledTimes(2);
  });
});
