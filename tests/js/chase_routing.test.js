const { loadScript } = require('./helpers/loadScript');

// chase_routing.js schedules a real setInterval poller at load time (looking
// for the routing modal's DOM to appear) - fake timers stop that from
// actually ticking during tests. This doesn't affect Promise/microtask
// scheduling (fetchOsrmRoute's .then() chains), which is native and
// untouched by fake timers, so no special handling is needed to await those
// below.
jest.useFakeTimers();

global.$ = global.jQuery = require('jquery');
// fetchOsrmRoute/applyFetchedRoute render via window.showChaseRouteOnCesium
// (see cesium-map.js) rather than touching a map library directly - a
// minimal stub keeps this test about the sequencing logic, not Cesium.

// renderRoutePanel() calls escapeHtml() (utils.js) for the callsign/turn text.
loadScript('utils.js');
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
    global.showChaseRouteOnCesium = jest.fn();

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

    expect(showChaseRouteOnCesium).toHaveBeenCalledTimes(1);
    // applyFetchedRoute converts [lon,lat] pairs to [lat,lon] order.
    expect(showChaseRouteOnCesium.mock.calls[0][0]).toEqual([[39.0, -83.0], [39.2, -83.2]]);
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

    expect(showChaseRouteOnCesium).toHaveBeenCalledTimes(1);
    expect(showChaseRouteOnCesium.mock.calls[0][0]).toEqual([[40.0, -84.0], [40.2, -84.2]]);

    // Older (stale) request's response arrives late - must be ignored entirely.
    older.resolve(jsonResponse(backendRouteBody([[-83.0, 39.0], [-83.2, 39.2]])));
    await flushMicrotasks();

    expect(showChaseRouteOnCesium).toHaveBeenCalledTimes(1); // still just the one call, from call 2
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

    expect(showChaseRouteOnCesium).toHaveBeenCalledTimes(1);
    expect(showChaseRouteOnCesium.mock.calls[0][0]).toEqual([[1, 1], [2, 2]]);
    warnSpy.mockRestore();
  });

  test('a lone request (no race) still applies normally through the sequencing guard', async () => {
    // Guards against a fix that's *too* aggressive (e.g. rejecting anything
    // but the very first call ever made, rather than only superseded ones).
    window.fetchOsrmRoute(10, 10, 11, 11);
    takeNextRouteFetch().resolve(jsonResponse(backendRouteBody([[10, 10], [11, 11]])));
    await flushMicrotasks();
    expect(showChaseRouteOnCesium).toHaveBeenCalledTimes(1);

    window.fetchOsrmRoute(20, 20, 21, 21);
    takeNextRouteFetch().resolve(jsonResponse(backendRouteBody([[20, 20], [21, 21]])));
    await flushMicrotasks();
    expect(showChaseRouteOnCesium).toHaveBeenCalledTimes(2);
  });
});

describe('renderRoutePanel - floating footer visibility', () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<div id="routePanel"></div><div id="routePanelFooter"></div>' +
      '<span id="telemReadoutAlt"></span><span id="telemReadoutDescent"></span><span id="telemReadoutEta">--</span>';
    window.balloon_currently_chased = 'KF6RFX-2';
    window.currentSelectedRoute = {
      distance: 1000,
      duration: 120,
      instructions: [{ type: 'Straight', road: 'Main St', distance: 500 }],
    };
    window.currentRouteAlternatives = null;
    window.route_preference = 'fastest';
  });

  function footerVisible() {
    return $('#routePanelFooter').css('display') !== 'none';
  }

  test('collapsing the open panel shows the floating footer', () => {
    window.openRoutePanel(); // resets route_panel_collapsed to false
    $('.route-panel-collapse-btn').trigger('click'); // toggles it to true

    expect(footerVisible()).toBe(true);
  });

  test('closing the panel hides the floating footer even though it stays collapsed', () => {
    window.openRoutePanel();
    $('.route-panel-collapse-btn').trigger('click');
    expect(footerVisible()).toBe(true);

    window.closeRoutePanel();
    expect(footerVisible()).toBe(false);
  });

  test('a background re-render after closing a collapsed panel does not resurrect the floating footer', () => {
    // Reproduces the reported bug: closeRoutePanel() hides the footer but
    // never resets route_panel_collapsed, so a later renderRoutePanel() call
    // triggered by something unrelated to the panel itself (e.g. the route
    // recalculating as the car moves - see advanceDisplayedRouteAlongIndex/
    // fetchOsrmRoute's own unconditional renderRoutePanel() calls) used to
    // silently reshow the stale collapsed footer on top of the routing-active
    // pill and the telemetry readout card, all three stacked bottom-left.
    window.openRoutePanel();
    $('.route-panel-collapse-btn').trigger('click'); // collapse
    window.closeRoutePanel(); // navigate away from Route while still routing
    expect(footerVisible()).toBe(false);

    window.renderRoutePanel(); // the unrelated background re-render
    expect(footerVisible()).toBe(false);
  });
});

describe('routing-active pill vs telemetry card overlap', () => {
  // jsdom has no real layout/CSS engine - getBoundingClientRect() always
  // returns all-zero rects and, with no stylesheet loaded, getComputedStyle()
  // can't resolve .routing-active-pill's CSS-defined `bottom: 130px` either
  // (only real inline styles). Both are mocked per test so the underlying
  // function ("clear any old correction, measure, push up only if needed")
  // can be exercised the same way it runs in the real, styled app.
  function mockRect(el, rect) {
    el.getBoundingClientRect = () => ({
      top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, ...rect,
    });
  }

  // Captured once, outside beforeEach, so each test's spy wraps the true
  // original - re-capturing "the current window.getComputedStyle" inside
  // beforeEach would instead wrap the *previous* test's already-mocked
  // version and recurse forever.
  const realGetComputedStyle = window.getComputedStyle;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    document.body.innerHTML =
      '<div id="routingActivePill"></div><div id="telemReadoutCard"></div><span id="chaseStatusETA">10m</span>';
    window.balloon_currently_chased = 'KF6RFX-2';
    window.closeRoutePanel(); // ensures route_panel_open is false regardless of prior test state

    jest.spyOn(window, 'getComputedStyle').mockImplementation((el) => {
      const real = realGetComputedStyle(el);
      if (!el || el.id !== 'routingActivePill') return real;
      // Stands in for the stylesheet's `bottom: 130px` default (no
      // stylesheet is loaded in this test) - the function always clears any
      // inline override before reading this, so it has to hold steady
      // regardless of that clear. Proxies the real CSSStyleDeclaration for
      // everything else jQuery's own .show()/.css() calls need (like
      // getPropertyValue), rather than replacing it with a plain object.
      return new Proxy(real, {
        get(target, prop) {
          if (prop === 'bottom') return '130px';
          if (prop === 'getPropertyValue') {
            return (name) => (name === 'bottom' ? '130px' : target.getPropertyValue(name));
          }
          const value = target[prop];
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    });
  });

  test('leaves the pill at its CSS default position when it does not overlap the telem card', () => {
    const pill = document.getElementById('routingActivePill');
    const telem = document.getElementById('telemReadoutCard');
    mockRect(pill, { top: 600, bottom: 650 });
    mockRect(telem, { top: 700, bottom: 800 }); // well below the pill - no overlap

    window.renderRoutingActivePill();

    expect(pill.style.bottom).toBe('');
  });

  test('pushes the pill up by exactly the overlap plus a gap when it collides with a tall telem card', () => {
    const pill = document.getElementById('routingActivePill');
    const telem = document.getElementById('telemReadoutCard');
    mockRect(pill, { top: 650, bottom: 700 });
    mockRect(telem, { top: 680, bottom: 800 }); // telem's top is 20px above the pill's bottom

    window.renderRoutingActivePill();

    // 130 (CSS default) + 20 (overlap) + 12 (gap) = 162
    expect(pill.style.bottom).toBe('162px');
  });

  test('does not correct against a hidden telem card', () => {
    const pill = document.getElementById('routingActivePill');
    const telem = document.getElementById('telemReadoutCard');
    telem.style.display = 'none';
    mockRect(pill, { top: 650, bottom: 700 });
    mockRect(telem, { top: 680, bottom: 800 }); // would overlap if visible

    window.renderRoutingActivePill();

    expect(pill.style.bottom).toBe('');
  });
});
