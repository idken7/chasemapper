import { useTelemetryStore } from './telemetryStore';
import type { PayloadTelem, TelemetryArchive, TelemetryEventCar } from '../api/types';
import { CHASE_VEHICLE_STALE_MS } from '../api/constants';

function makeTelem(overrides: Partial<PayloadTelem> = {}): PayloadTelem {
  return {
    callsign: 'CHASER1',
    position: [40.0, -105.0, 5000],
    vel_v: 5.0,
    speed: 10,
    short_time: '12:00:00',
    packet_time: '2026-01-01T12:00:00Z',
    time_to_landing: null,
    server_time: 1000,
    max_alt: 5000,
    ...overrides,
  };
}

describe('telemetryStore.hydrateFromArchive', () => {
  beforeEach(() => {
    useTelemetryStore.setState({ balloons: {}, target: null, followedCallsign: null });
  });

  test('populates a fresh balloon with full path/prediction history from the archive', () => {
    const archive: TelemetryArchive = {
      CHASER1: {
        telem: makeTelem(),
        path: [
          [39.9, -105.1, 100],
          [40.0, -105.0, 5000],
        ],
        pred_path: [
          [40.0, -105.0, 5000],
          [40.5, -104.5, 0],
        ],
        pred_landing: [40.5, -104.5, 0],
        burst: [40.2, -104.8, 30000],
        abort_path: [],
        abort_landing: [],
      },
    };

    useTelemetryStore.getState().hydrateFromArchive(archive);
    const track = useTelemetryStore.getState().balloons.CHASER1;

    expect(track.path).toEqual(archive.CHASER1.path);
    expect(track.predPath).toEqual(archive.CHASER1.pred_path);
    expect(track.predLanding).toEqual([40.5, -104.5, 0]);
    expect(track.burst).toEqual([40.2, -104.8, 30000]);
  });

  test('appends a newer live point onto the archived path instead of discarding it', () => {
    // Live telemetry_event already arrived (e.g. via client_connected) before the
    // slower REST archive fetch resolved.
    useTelemetryStore.getState().handleTelemetryEvent(makeTelem({ position: [40.1, -104.9, 6000] }), null);

    const archive: TelemetryArchive = {
      CHASER1: {
        telem: makeTelem(),
        path: [
          [39.9, -105.1, 100],
          [40.0, -105.0, 5000],
        ],
        pred_path: [],
        pred_landing: [],
        burst: [],
        abort_path: [],
        abort_landing: [],
      },
    };

    useTelemetryStore.getState().hydrateFromArchive(archive);
    const track = useTelemetryStore.getState().balloons.CHASER1;

    expect(track.path).toEqual([
      [39.9, -105.1, 100],
      [40.0, -105.0, 5000],
      [40.1, -104.9, 6000],
    ]);
    // The live telem (the newer position) wins over the archive's stale snapshot.
    expect(track.telem.position).toEqual([40.1, -104.9, 6000]);
  });

  test('does not overwrite a prediction already delivered live by the socket', () => {
    useTelemetryStore.getState().handleTelemetryEvent(makeTelem(), null);
    useTelemetryStore.getState().handlePredictorUpdate({
      callsign: 'CHASER1',
      pred_path: [[40.0, -105.0, 5000]],
      pred_landing: [41.0, -103.0, 0],
      burst: [],
      abort_path: [],
      abort_landing: [],
    });

    const archive: TelemetryArchive = {
      CHASER1: {
        telem: makeTelem(),
        path: [[40.0, -105.0, 5000]],
        pred_path: [[40.0, -105.0, 5000], [39.0, -102.0, 0]],
        pred_landing: [39.0, -102.0, 0], // stale compared to the live update above
        burst: [],
        abort_path: [],
        abort_landing: [],
      },
    };

    useTelemetryStore.getState().hydrateFromArchive(archive);
    const track = useTelemetryStore.getState().balloons.CHASER1;

    expect(track.predLanding).toEqual([41.0, -103.0, 0]);
    expect(track.predPath).toEqual([[40.0, -105.0, 5000]]);
  });

  test('skips archive entries with no telem', () => {
    const archive = { GHOST: {} } as unknown as TelemetryArchive;
    useTelemetryStore.getState().hydrateFromArchive(archive);
    expect(useTelemetryStore.getState().balloons.GHOST).toBeUndefined();
  });
});

function makeCarEvent(carId: string | undefined, overrides: Partial<TelemetryEventCar> = {}): TelemetryEventCar {
  return {
    callsign: 'CAR',
    position: [42.0, -83.0, 250],
    vel_v: 0,
    heading: 90,
    heading_valid: true,
    heading_status: 'gps',
    speed: 15,
    car_id: carId,
    car_name: carId,
    ...overrides,
  };
}

describe('telemetryStore other-chaser car lifecycle', () => {
  const T0 = 1_000_000_000_000;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(T0);
    useTelemetryStore.setState({ ownCar: null, primaryCar: null, otherCars: {}, otherCarsSeenAt: {} });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('records when each other chaser was last heard from', () => {
    useTelemetryStore.getState().handleTelemetryEvent(makeCarEvent('car-a'), 'me');
    const state = useTelemetryStore.getState();
    expect(Object.keys(state.otherCars)).toEqual(['car-a']);
    expect(state.otherCarsSeenAt['car-a']).toBe(T0);
  });

  test('pruneStaleCars drops only cars quiet for longer than the stale threshold', () => {
    const store = useTelemetryStore.getState();
    store.handleTelemetryEvent(makeCarEvent('old-car'), 'me');
    jest.setSystemTime(T0 + CHASE_VEHICLE_STALE_MS - 60_000);
    store.handleTelemetryEvent(makeCarEvent('fresh-car'), 'me');

    useTelemetryStore.getState().pruneStaleCars(T0 + CHASE_VEHICLE_STALE_MS + 1);

    const state = useTelemetryStore.getState();
    expect(Object.keys(state.otherCars)).toEqual(['fresh-car']);
    expect(Object.keys(state.otherCarsSeenAt)).toEqual(['fresh-car']);
  });

  test('a fresh update keeps a car alive past its original stale deadline', () => {
    const store = useTelemetryStore.getState();
    store.handleTelemetryEvent(makeCarEvent('car-a'), 'me');
    jest.setSystemTime(T0 + CHASE_VEHICLE_STALE_MS - 1000);
    store.handleTelemetryEvent(makeCarEvent('car-a', { position: [42.1, -83.1, 250] }), 'me');

    useTelemetryStore.getState().pruneStaleCars(T0 + CHASE_VEHICLE_STALE_MS + 1000);

    expect(useTelemetryStore.getState().otherCars['car-a']).toBeDefined();
  });

  test('pruning never removes our own car or the primary hardware car', () => {
    const store = useTelemetryStore.getState();
    store.handleTelemetryEvent(makeCarEvent('me'), 'me'); // own car
    store.handleTelemetryEvent(makeCarEvent(undefined), 'me'); // legacy primary car
    store.handleTelemetryEvent(makeCarEvent('car-a'), 'me');

    useTelemetryStore.getState().pruneStaleCars(T0 + CHASE_VEHICLE_STALE_MS * 10);

    const state = useTelemetryStore.getState();
    expect(state.ownCar).not.toBeNull();
    expect(state.primaryCar).not.toBeNull();
    expect(state.otherCars).toEqual({});
  });

  test('pruneStaleCars leaves state untouched (same reference) when nothing is stale', () => {
    useTelemetryStore.getState().handleTelemetryEvent(makeCarEvent('car-a'), 'me');
    const before = useTelemetryStore.getState().otherCars;
    useTelemetryStore.getState().pruneStaleCars(T0 + 1000);
    expect(useTelemetryStore.getState().otherCars).toBe(before);
  });

  test('clearOtherCars empties other chasers but keeps our own car', () => {
    const store = useTelemetryStore.getState();
    store.handleTelemetryEvent(makeCarEvent('me'), 'me');
    store.handleTelemetryEvent(makeCarEvent('car-a'), 'me');
    store.handleTelemetryEvent(makeCarEvent('car-b'), 'me');

    useTelemetryStore.getState().clearOtherCars();

    const state = useTelemetryStore.getState();
    expect(state.otherCars).toEqual({});
    expect(state.otherCarsSeenAt).toEqual({});
    expect(state.ownCar?.car_id).toBe('me');
  });
});
