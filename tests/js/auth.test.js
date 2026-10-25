const { loadScript } = require('./helpers/loadScript');

// auth.js registers jQuery.ajaxSetup/ajaxError at load time, so real jQuery
// has to exist first - the same order the templates load them in.
global.$ = global.jQuery = require('jquery');

loadScript('auth.js');

// jsdom's default page URL is http://localhost/ - same-origin URLs below are
// relative paths or http://localhost/..., cross-origin ones anything else.

function fakeXhr() {
  return { setRequestHeader: jest.fn() };
}

beforeEach(() => {
  localStorage.clear();
  window._apiKeyPromptShown = false;
  window.prompt = jest.fn();
  window.chasemapperReloadPage = jest.fn();
});

describe('saved API key', () => {
  test('defaults to an empty string', () => {
    expect(getSavedApiKey()).toBe('');
  });

  test('round-trips through localStorage under the key index.html always used', () => {
    setSavedApiKey('abc123');
    expect(getSavedApiKey()).toBe('abc123');
    expect(localStorage.getItem('chasemapper_api_key')).toBe('abc123');
  });
});

describe('ajaxSetup beforeSend', () => {
  const beforeSend = () => jQuery.ajaxSettings.beforeSend;

  test('adds X-API-Key to same-origin requests when a key is saved', () => {
    setSavedApiKey('k1');
    const xhr = fakeXhr();
    beforeSend()(xhr, { url: '/get_config', crossDomain: false });
    expect(xhr.setRequestHeader).toHaveBeenCalledWith('X-API-Key', 'k1');
  });

  test('also treats an absolute URL on this origin as same-origin', () => {
    setSavedApiKey('k1');
    const xhr = fakeXhr();
    beforeSend()(xhr, { url: 'http://localhost/get_telemetry_archive' });
    expect(xhr.setRequestHeader).toHaveBeenCalledWith('X-API-Key', 'k1');
  });

  test('adds nothing when no key is saved', () => {
    const xhr = fakeXhr();
    beforeSend()(xhr, { url: '/get_config', crossDomain: false });
    expect(xhr.setRequestHeader).not.toHaveBeenCalled();
  });

  test('never sends the key to another host (SondeHub/Habitat use $.ajax too)', () => {
    setSavedApiKey('k1');
    const xhr = fakeXhr();
    beforeSend()(xhr, { url: 'https://api.v2.sondehub.org/listeners', crossDomain: true });
    expect(xhr.setRequestHeader).not.toHaveBeenCalled();
  });

  test('respects jQuery crossDomain=true even if the URL parses as same-origin', () => {
    setSavedApiKey('k1');
    const xhr = fakeXhr();
    beforeSend()(xhr, { url: '/get_config', crossDomain: true });
    expect(xhr.setRequestHeader).not.toHaveBeenCalled();
  });
});

describe('chasemapperSocketOptions', () => {
  test('is empty with no saved key', () => {
    expect(chasemapperSocketOptions()).toEqual({});
  });

  test('passes the saved key as the api_key query parameter', () => {
    setSavedApiKey('k2');
    expect(chasemapperSocketOptions()).toEqual({ query: { api_key: 'k2' } });
  });
});

describe('chasemapperAuthHeaders', () => {
  test('copies the given headers and adds the key', () => {
    setSavedApiKey('k3');
    const input = { 'Content-Type': 'application/json' };
    expect(chasemapperAuthHeaders(input)).toEqual({ 'Content-Type': 'application/json', 'X-API-Key': 'k3' });
    expect(input).toEqual({ 'Content-Type': 'application/json' }); // not mutated
  });

  test('returns the headers unchanged when no key is saved', () => {
    expect(chasemapperAuthHeaders({ A: 'b' })).toEqual({ A: 'b' });
    expect(chasemapperAuthHeaders()).toEqual({});
  });
});

describe('promptForApiKeyAndReload', () => {
  test('saves the entered key (trimmed) and reloads', () => {
    window.prompt.mockReturnValue('  newkey  ');
    expect(promptForApiKeyAndReload()).toBe(true);
    expect(getSavedApiKey()).toBe('newkey');
    expect(window.chasemapperReloadPage).toHaveBeenCalledTimes(1);
  });

  test('does nothing if the prompt is cancelled or left blank', () => {
    window.prompt.mockReturnValue(null);
    expect(promptForApiKeyAndReload()).toBe(false);
    expect(getSavedApiKey()).toBe('');
    expect(window.chasemapperReloadPage).not.toHaveBeenCalled();
  });

  test('prompts only once per page load, even if several requests fail together', () => {
    window.prompt.mockReturnValue(null);
    promptForApiKeyAndReload();
    promptForApiKeyAndReload();
    promptForApiKeyAndReload();
    expect(window.prompt).toHaveBeenCalledTimes(1);
  });
});

describe('ajaxError hook', () => {
  test('a same-origin 401 prompts for the key', () => {
    window.prompt.mockReturnValue(null);
    $(document).trigger('ajaxError', [{ status: 401 }, { url: '/get_config' }]);
    expect(window.prompt).toHaveBeenCalledTimes(1);
  });

  test('other errors do not prompt', () => {
    $(document).trigger('ajaxError', [{ status: 500 }, { url: '/get_config' }]);
    $(document).trigger('ajaxError', [{ status: 0 }, { url: '/get_bearings' }]);
    expect(window.prompt).not.toHaveBeenCalled();
  });

  test('a 401 from another host does not prompt', () => {
    $(document).trigger('ajaxError', [{ status: 401 }, { url: 'https://api.v2.sondehub.org/x' }]);
    expect(window.prompt).not.toHaveBeenCalled();
  });
});

describe('registerSocketAuthHandler', () => {
  function fakeSocket() {
    const handlers = {};
    return {
      on: jest.fn((name, fn) => { handlers[name] = fn; }),
      fire: (name, arg) => handlers[name](arg),
    };
  }

  test('an "unauthorized" connect_error prompts for the key', () => {
    const sock = fakeSocket();
    registerSocketAuthHandler(sock);
    window.prompt.mockReturnValue('k4');
    sock.fire('connect_error', new Error('unauthorized'));
    expect(getSavedApiKey()).toBe('k4');
    expect(window.chasemapperReloadPage).toHaveBeenCalledTimes(1);
  });

  test('other connect errors (e.g. server down) do not prompt', () => {
    const sock = fakeSocket();
    registerSocketAuthHandler(sock);
    sock.fire('connect_error', new Error('xhr poll error'));
    expect(window.prompt).not.toHaveBeenCalled();
  });

  test('ignores a missing socket', () => {
    expect(() => registerSocketAuthHandler(null)).not.toThrow();
  });
});
