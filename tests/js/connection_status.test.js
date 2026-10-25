const { loadScript } = require('./helpers/loadScript');

loadScript('connection_status.js');

// Minimal Socket.IO client stand-in: records handlers so tests can fire them.
function fakeSocket(connected) {
  const handlers = {};
  const ioHandlers = {};
  return {
    connected: !!connected,
    on: (evt, fn) => { handlers[evt] = fn; },
    io: { on: (evt, fn) => { ioHandlers[evt] = fn; } },
    fire: (evt, arg) => handlers[evt](arg),
    fireIo: (evt, arg) => ioHandlers[evt](arg),
  };
}

beforeEach(() => {
  document.body.innerHTML =
    '<span id="serverStatusLabel" class="server-status-connecting">CONNECTING</span>' +
    '<span id="chaserCountLabel">3 connected</span>';
});

const label = () => document.getElementById('serverStatusLabel');
const count = () => document.getElementById('chaserCountLabel');

describe('updateServerConnectionDisplay', () => {
  test('LIVE only while connected, and keeps the connected count', () => {
    updateServerConnectionDisplay('live');
    expect(label().textContent).toBe('LIVE');
    expect(label().classList.contains('server-status-live')).toBe(true);
    expect(label().classList.contains('server-status-connecting')).toBe(false);
    expect(count().textContent).toBe('3 connected');
  });

  test('offline replaces LIVE and blanks the stale count', () => {
    updateServerConnectionDisplay('offline');
    expect(label().textContent).toBe('OFFLINE');
    expect(label().classList.contains('server-status-offline')).toBe(true);
    expect(count().textContent).toBe('—');
  });

  test('ignores unknown states', () => {
    updateServerConnectionDisplay('bogus');
    expect(label().textContent).toBe('CONNECTING');
  });
});

describe('registerSocketStatusHandlers', () => {
  test('follows connect, disconnect and reconnect attempts', () => {
    const sock = fakeSocket(false);
    registerSocketStatusHandlers(sock);
    sock.fire('connect');
    expect(label().textContent).toBe('LIVE');
    sock.fire('disconnect');
    expect(label().textContent).toBe('OFFLINE');
    sock.fireIo('reconnect_attempt', 1);
    expect(label().textContent).toBe('CONNECTING');
  });

  test('a refused connection shows KEY NEEDED; other errors show OFFLINE', () => {
    const sock = fakeSocket(false);
    registerSocketStatusHandlers(sock);
    sock.fire('connect_error', new Error('unauthorized'));
    expect(label().textContent).toBe('KEY NEEDED');
    sock.fire('connect_error', new Error('xhr poll error'));
    expect(label().textContent).toBe('OFFLINE');
  });

  test('an already-connected socket shows LIVE straight away', () => {
    registerSocketStatusHandlers(fakeSocket(true));
    expect(label().textContent).toBe('LIVE');
  });
});
