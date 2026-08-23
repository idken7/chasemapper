import { create } from 'zustand';
import { addBoundedPoint } from '../utils/boundedTrack';
import type {
  CarState,
  LatLonAlt,
  PayloadTelem,
  PredictorUpdate,
  TargetState,
  TelemetryArchive,
  TelemetryEvent,
  TelemetryEventCar,
} from '../api/types';
import { isCarTelemetry } from '../api/types';

// Mirrors static/js/utils.js's `colour_values` — a 3-colour round-robin assigned to
// each newly-seen callsign in arrival order, so the same marker/path colour lines up
// between the mobile app and the desktop web client for a shared chase.
export type BalloonColour = 'blue' | 'green' | 'purple';
const COLOUR_VALUES: BalloonColour[] = ['blue', 'green', 'purple'];
let nextColourIndex = 0;
function nextColour(): BalloonColour {
  const colour = COLOUR_VALUES[nextColourIndex % COLOUR_VALUES.length];
  nextColourIndex += 1;
  return colour;
}

export interface BalloonTrack {
  telem: PayloadTelem;
  colour: BalloonColour;
  path: LatLonAlt[];
  predPath: LatLonAlt[];
  predLanding: LatLonAlt | null;
  burst: LatLonAlt | null;
  abortPath: LatLonAlt[];
  abortLanding: LatLonAlt | null;
  predictorUpdatedAt: number | null;
}

interface TelemetryState {
  primaryCar: CarState | null;
  ownCar: TelemetryEventCar | null;
  otherCars: Record<string, TelemetryEventCar>;
  balloons: Record<string, BalloonTrack>;
  target: TargetState | null;
  followedCallsign: string | null;

  setPrimaryCarFromMobileState: (car: CarState | null) => void;
  setTarget: (target: TargetState | null) => void;
  setFollowedCallsign: (callsign: string | null) => void;
  handleTelemetryEvent: (event: TelemetryEvent, ownClientId: string | null) => void;
  handlePredictorUpdate: (update: PredictorUpdate) => void;
  hydrateFromArchive: (archive: TelemetryArchive) => void;
  clearBalloon: (callsign: string) => void;
  clearAllPayloads: () => void;
  clearPrimaryCar: () => void;
}

function emptyBalloonTrack(telem: PayloadTelem): BalloonTrack {
  return {
    telem,
    colour: nextColour(),
    path: [telem.position],
    predPath: [],
    predLanding: null,
    burst: null,
    abortPath: [],
    abortLanding: null,
    predictorUpdatedAt: null,
  };
}

export const useTelemetryStore = create<TelemetryState>((set, get) => ({
  primaryCar: null,
  ownCar: null,
  otherCars: {},
  balloons: {},
  target: null,
  followedCallsign: null,

  setPrimaryCarFromMobileState: (car) => set({ primaryCar: car }),

  setTarget: (target) => set({ target }),

  setFollowedCallsign: (callsign) => set({ followedCallsign: callsign }),

  handleTelemetryEvent: (event, ownClientId) => {
    if (isCarTelemetry(event)) {
      const isOwn = !!event.car_id && !!ownClientId && event.car_id === ownClientId;
      if (isOwn) {
        set({ ownCar: event });
      } else if (event.car_id) {
        set((state) => ({ otherCars: { ...state.otherCars, [event.car_id as string]: event } }));
      } else {
        // Legacy primary hardware car, echoed back over the socket rather than mobile_state.
        set({
          primaryCar: {
            lat: event.position[0],
            lon: event.position[1],
            alt: event.position[2],
            speed: event.speed,
            heading: event.heading,
            heading_valid: event.heading_valid,
            last_update: event.replay_time ?? null,
          },
        });
      }
      return;
    }

    const existing = get().balloons[event.callsign];
    const nextTrack: BalloonTrack = existing
      ? { ...existing, telem: event, path: addBoundedPoint(existing.path, event.position) }
      : emptyBalloonTrack(event);
    set((state) => ({ balloons: { ...state.balloons, [event.callsign]: nextTrack } }));
  },

  handlePredictorUpdate: (update) => {
    const existing = get().balloons[update.callsign];
    if (!existing) return; // predictor updates arrive after at least one telemetry point
    set((state) => ({
      balloons: {
        ...state.balloons,
        [update.callsign]: {
          ...existing,
          predPath: update.pred_path,
          predLanding: update.pred_landing.length ? (update.pred_landing as LatLonAlt) : null,
          burst: update.burst.length ? (update.burst as LatLonAlt) : null,
          abortPath: update.abort_path,
          abortLanding: update.abort_landing.length ? (update.abort_landing as LatLonAlt) : null,
          predictorUpdatedAt: Date.now(),
        },
      },
    }));
  },

  // Bootstraps history the live socket never sends: telemetry_event only ever carries
  // the latest point, and predictor_update is a full-replacement snapshot with no
  // memory of earlier predictions. Runs once per socket connect (see useChaseMapperSocket)
  // — an existing live path/prediction may already be ahead of what the archive fetch
  // saw, so this fills gaps rather than overwriting: the actual-path trail is merged
  // (archive history + any newer live point not yet reflected in it), while
  // prediction/landing/burst fields only backfill when nothing has arrived live yet.
  hydrateFromArchive: (archive) =>
    set((state) => {
      const balloons = { ...state.balloons };
      for (const [callsign, entry] of Object.entries(archive)) {
        if (!entry?.telem) continue;
        const existing = balloons[callsign];

        let path = entry.path.length ? entry.path : (existing?.path ?? [entry.telem.position]);
        const liveTelem = existing?.telem;
        if (liveTelem) {
          const lastArchived = path[path.length - 1];
          const isNewPoint =
            !lastArchived || lastArchived[0] !== liveTelem.position[0] || lastArchived[1] !== liveTelem.position[1];
          if (isNewPoint) path = [...path, liveTelem.position];
        }

        balloons[callsign] = {
          telem: liveTelem ?? entry.telem,
          colour: existing?.colour ?? nextColour(),
          path,
          predPath: existing?.predPath.length ? existing.predPath : entry.pred_path,
          predLanding: existing?.predLanding ?? (entry.pred_landing.length ? (entry.pred_landing as LatLonAlt) : null),
          burst: existing?.burst ?? (entry.burst.length ? (entry.burst as LatLonAlt) : null),
          abortPath: existing?.abortPath.length ? existing.abortPath : entry.abort_path,
          abortLanding:
            existing?.abortLanding ?? (entry.abort_landing.length ? (entry.abort_landing as LatLonAlt) : null),
          predictorUpdatedAt: existing?.predictorUpdatedAt ?? null,
        };
      }
      return { balloons };
    }),

  clearBalloon: (callsign) =>
    set((state) => {
      const { [callsign]: _removed, ...rest } = state.balloons;
      return {
        balloons: rest,
        followedCallsign: state.followedCallsign === callsign ? null : state.followedCallsign,
      };
    }),

  clearAllPayloads: () => set({ balloons: {}, target: null }),

  clearPrimaryCar: () => set({ primaryCar: null }),
}));
