import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { getMissionType } from './sim/data/missions';
import { FLEET_PRESETS_BY_ID } from './sim/data/presets';
import {
  addDispatchCenter,
  addMission,
  addStation,
  addUnit,
  beginPatrol,
  candidatesForMission,
  canPatrol,
  closeMission,
  createGame,
  dispatchUnit,
  isAvailable,
  missionUnits,
  pickPatrolWaypoint,
  planCall,
  releaseUnit,
  removeStation,
  removeUnit,
  renameUnit,
  stationsDueForCall,
  tick,
  unitPosition,
  updateStation,
  type NewStation,
  type Route,
} from './sim/engine';
import { buildCumTime } from './sim/geo';
import { matchRequirements, recommendUnits } from './sim/requirements';
import type { GameState, LatLng, Station } from './sim/types';
import { getRoute, reverseGeocode, snapToRoad } from './services/mapServices';

/**
 * The loop updates state ~10×/s; serialising the whole save that often is
 * wasteful. Buffer writes and flush at most every 2 s, and when the page hides.
 */
const throttledLocalStorage = (() => {
  const pending = new Map<string, string>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    for (const [k, v] of pending) {
      try {
        localStorage.setItem(k, v);
      } catch {
        // Quota exceeded / storage disabled: keep playing without saving.
      }
    }
    pending.clear();
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
  }
  return {
    getItem: (k: string) => {
      try {
        return pending.get(k) ?? localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    setItem: (k: string, v: string) => {
      pending.set(k, v);
      timer ??= setTimeout(flush, 2000);
    },
    removeItem: (k: string) => {
      pending.delete(k);
      try {
        localStorage.removeItem(k);
      } catch {
        // ignore
      }
    },
  };
})();

export const SPEEDS = [0, 1, 5, 10, 30] as const;
export type Speed = (typeof SPEEDS)[number];
export type BaseLayer = 'streets' | 'dark' | 'topo';
export type Tab = 'calls' | 'stations' | 'log';

export interface Settings {
  /** Use the OSRM road router (and road-snapping for calls). Off = straight-line estimates. */
  roadRouting: boolean;
  /** Clear calls automatically once the work is done. */
  autoClear: boolean;
  /**
   * Analyze every open call (required roles, water, personnel, distance,
   * availability) and assign units automatically, the same way "Select
   * recommended" + Dispatch would. Manual dispatch and release always
   * still work — this just means a call doesn't have to wait on you.
   */
  autoDispatch: boolean;
  /**
   * Idle patrol units (role 'patrol') drive ambient legs around their
   * station's coverage area at the posted limit — no lights-and-siren
   * boost — instead of just sitting at the station. They're still pulled
   * off patrol for a dispatch exactly like an in-quarters unit, just with
   * no turnout delay since they're already rolling.
   */
  autoPatrol: boolean;
  baseLayer: BaseLayer;
}

export interface DraftStation {
  position: LatLng;
  address: string;
  resolving: boolean;
}

interface Ui {
  tab: Tab;
  selectedMissionId: string | null;
  selectedStationId: string | null;
  /** Waiting for a map click to place a station. */
  placing: boolean;
  draftStation: DraftStation | null;
  /** Bumping `key` makes the map fly even to the same spot twice. */
  flyTo: { position: LatLng; zoom: number; key: number } | null;
  /** Units / missions with a network request in flight (prevents double-submits). */
  busy: Record<string, true>;
  sheetExpanded: boolean;
  /** Result of an address search, shown as a pin with a "place station here" action. */
  searchPin: { position: LatLng; label: string; short: string } | null;
}

interface Store {
  game: GameState;
  speed: Speed;
  settings: Settings;
  ui: Ui;

  advance(realDtMs: number): void;
  setSpeed(speed: Speed): void;
  updateSettings(patch: Partial<Settings>): void;
  resetGame(): void;

  setTab(tab: Tab): void;
  selectMission(id: string | null): void;
  selectStation(id: string | null): void;
  flyTo(position: LatLng, zoom?: number): void;
  setSheetExpanded(v: boolean): void;
  setSearchPin(pin: Ui['searchPin']): void;

  startPlacing(): void;
  cancelPlacing(): void;
  draftStationAt(position: LatLng, address?: string): void;
  /**
   * `centerId: null` starts a brand-new dispatch center named `newCenterName`
   * (falling back to "<station name> Dispatch"); an existing id joins that
   * center's shared call/unit pool instead — the explicit mutual-aid choice.
   */
  confirmStation(
    input: Omit<NewStation, 'position' | 'centerId'> & { presetId: string; centerId: string | null; newCenterName?: string },
  ): void;
  editStation(id: string, patch: Partial<Pick<Station, 'name' | 'address' | 'staffing' | 'responseRadiusKm'>>): void;
  deleteStation(id: string): void;

  addUnitToStation(stationId: string, specId: string, callsign: string): void;
  renameUnit(unitId: string, callsign: string): void;
  removeUnit(unitId: string): void;

  dispatch(missionId: string, unitIds: string[]): Promise<void>;
  releaseUnit(unitId: string): Promise<void>;
  closeMission(missionId: string, outcome: 'completed' | 'cancelled'): Promise<void>;
}

const initialUi = (): Ui => ({
  tab: 'calls',
  selectedMissionId: null,
  selectedStationId: null,
  placing: false,
  draftStation: null,
  flyTo: null,
  busy: {},
  sheetExpanded: false,
  searchPin: null,
});

export const useStore = create<Store>()(
  persist(
    (set, get) => {
      const setGame = (fn: (g: GameState) => GameState) => set((s) => ({ game: fn(s.game) }));
      const setBusy = (ids: string[], on: boolean) =>
        set((s) => {
          const busy = { ...s.ui.busy };
          for (const id of ids) {
            if (on) busy[id] = true;
            else delete busy[id];
          }
          return { ui: { ...s.ui, busy } };
        });
      const patchUi = (patch: Partial<Ui>) => set((s) => ({ ui: { ...s.ui, ...patch } }));

      /** Route each unit home from wherever it is now. */
      const routesHome = async (unitIds: string[]): Promise<Record<string, Route>> => {
        const { game, settings } = get();
        const entries = await Promise.all(
          unitIds.map(async (id) => {
            const u = game.units[id];
            const station = u && game.stations[u.stationId];
            if (!u || !station || u.status === 'dispatched') return null;
            const route = await getRoute(unitPosition(u, game.clock), station.position, settings.roadRouting);
            return [id, route] as const;
          }),
        );
        return Object.fromEntries(entries.filter((e) => e !== null));
      };

      /** Plan → snap to a road → reverse-geocode → put the call on the board. */
      const spawnCall = async (stationId: string) => {
        const { state, plan } = planCall(get().game, stationId, Math.random);
        set({ game: state });
        if (!plan) return;
        const position = await snapToRoad(plan.position, get().settings.roadRouting);
        const address = await reverseGeocode(position);
        if (!get().game.stations[stationId]) return; // station removed meanwhile
        setGame((g) => addMission(g, { ...plan, position }, address).state);
      };

      // advance() runs several times a second; a pass takes real time (route
      // lookups), so a flag — not component state — keeps passes from piling up.
      let autoDispatchRunning = false;

      /**
       * The M3 auto-dispatch AI: walk every open call that isn't fully
       * covered yet, oldest first (so an older call isn't repeatedly
       * leapfrogged by newer ones for the same nearby units), and assign
       * the same recommended set "Select recommended" would — closest and
       * best-suited units first, holding back a center's last unit of a
       * kind until nothing else can fill that slot. Purely additive: manual
       * dispatch and release work exactly as before, any time.
       */
      const autoDispatchPass = async () => {
        if (autoDispatchRunning) return;
        autoDispatchRunning = true;
        try {
          const openMissionIds = Object.values(get().game.missions)
            .filter((m) => m.status === 'pending' || m.status === 'dispatched')
            .sort((a, b) => a.createdAt - b.createdAt)
            .map((m) => m.id);
          for (const missionId of openMissionIds) {
            if (!get().settings.autoDispatch) return; // turned off mid-pass
            if (get().ui.busy[missionId]) continue;
            const game = get().game;
            const mission = game.missions[missionId];
            if (!mission || (mission.status !== 'pending' && mission.status !== 'dispatched')) continue;
            const type = getMissionType(mission.typeId);
            const assigned = missionUnits(game, mission);
            if (matchRequirements(type, assigned).met) continue;
            const candidates = candidatesForMission(game, mission).map((c) => c.unit);
            const pick = recommendUnits(type, assigned, candidates);
            if (pick && pick.length > 0) await get().dispatch(missionId, pick.map((u) => u.id));
          }
        } finally {
          autoDispatchRunning = false;
        }
      };

      let autoPatrolRunning = false;

      /**
       * Ambient patrol: every idle patrol-role unit (in quarters, or
       * between legs) picks a random point inside its station's coverage
       * area and drives there at the posted limit — no lights-and-siren
       * boost — then does it again. Mirrors spawnCall/autoDispatchPass:
       * the random waypoint and route lookup need rng/network the pure
       * engine doesn't have, so that happens here and gets committed with
       * `beginPatrol`. A unit dispatched to a real call mid-lookup is
       * simply skipped — `beginPatrol` itself re-checks status before
       * touching anything.
       */
      const autoPatrolPass = async () => {
        if (autoPatrolRunning) return;
        autoPatrolRunning = true;
        try {
          const dueIds = Object.values(get().game.units)
            .filter((u) => !u.trip && (u.status === 'in_quarters' || u.status === 'patrolling') && canPatrol(u))
            .map((u) => u.id);
          for (const unitId of dueIds) {
            if (!get().settings.autoPatrol) return; // turned off mid-pass
            const game = get().game;
            const unit = game.units[unitId];
            const station = unit && game.stations[unit.stationId];
            if (!unit || !station || unit.trip || (unit.status !== 'in_quarters' && unit.status !== 'patrolling')) continue;
            const from = unitPosition(unit, game.clock);
            const to = pickPatrolWaypoint(station, Math.random);
            const route = await getRoute(from, to, get().settings.roadRouting);
            setGame((g) => beginPatrol(g, unitId, route, to));
          }
        } finally {
          autoPatrolRunning = false;
        }
      };

      return {
        game: createGame(Date.now()),
        speed: 1,
        settings: { roadRouting: true, autoClear: false, autoDispatch: false, autoPatrol: true, baseLayer: 'streets' },
        ui: initialUi(),

        advance(realDtMs) {
          const { speed, settings } = get();
          if (speed === 0) return;
          // Cap so a backgrounded tab doesn't fast-forward hours on return.
          const simDt = Math.min(realDtMs, 1000) * speed;
          setGame((g) => tick(g, simDt));
          for (const st of stationsDueForCall(get().game)) void spawnCall(st.id);
          if (settings.autoClear) {
            for (const m of Object.values(get().game.missions)) {
              if (m.status === 'resolved' && !get().ui.busy[m.id]) void get().closeMission(m.id, 'completed');
            }
          }
          if (settings.autoDispatch) void autoDispatchPass();
          if (settings.autoPatrol) void autoPatrolPass();
        },

        setSpeed: (speed) => set({ speed }),
        updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
        resetGame: () => set({ game: createGame(Date.now()), ui: initialUi(), speed: 1 }),

        setTab: (tab) => patchUi({ tab, sheetExpanded: true }),
        selectMission: (id) => {
          const m = id ? get().game.missions[id] : null;
          patchUi({
            selectedMissionId: id,
            ...(m ? { tab: 'calls' as Tab, sheetExpanded: true } : {}),
          });
        },
        selectStation: (id) => patchUi({ selectedStationId: id, ...(id ? { tab: 'stations' as Tab, sheetExpanded: true } : {}) }),
        flyTo: (position, zoom = 15) =>
          patchUi({ flyTo: { position, zoom, key: (get().ui.flyTo?.key ?? 0) + 1 } }),
        setSheetExpanded: (sheetExpanded) => patchUi({ sheetExpanded }),
        setSearchPin: (searchPin) => patchUi({ searchPin }),

        startPlacing: () => patchUi({ placing: true, draftStation: null, sheetExpanded: false }),
        cancelPlacing: () => patchUi({ placing: false, draftStation: null }),
        draftStationAt(position, address) {
          patchUi({
            placing: false,
            searchPin: null,
            draftStation: { position, address: address ?? 'Looking up address…', resolving: !address },
          });
          if (address) return;
          void reverseGeocode(position).then((addr) => {
            const d = get().ui.draftStation;
            if (d && d.position === position) patchUi({ draftStation: { ...d, address: addr, resolving: false } });
          });
        },
        confirmStation({ presetId, centerId, newCenterName, ...input }) {
          const draft = get().ui.draftStation;
          if (!draft) return;
          let game = get().game;
          let resolvedCenterId = centerId;
          if (!resolvedCenterId) {
            const created = addDispatchCenter(game, newCenterName?.trim() || `${input.name} Dispatch`);
            game = created.state;
            resolvedCenterId = created.centerId;
          }
          let { state, stationId } = addStation(
            game,
            { ...input, position: draft.position, centerId: resolvedCenterId },
            Math.random,
          );
          for (const u of FLEET_PRESETS_BY_ID[presetId]?.units ?? []) state = addUnit(state, stationId, u.specId, u.callsign);
          set({ game: state });
          patchUi({ draftStation: null, selectedStationId: stationId, tab: 'stations', sheetExpanded: true });
        },
        editStation: (id, patch) => setGame((g) => updateStation(g, id, patch)),
        deleteStation: (id) => {
          setGame((g) => removeStation(g, id));
          if (!get().game.stations[id]) patchUi({ selectedStationId: null });
        },

        addUnitToStation: (stationId, specId, callsign) => setGame((g) => addUnit(g, stationId, specId, callsign)),
        renameUnit: (unitId, callsign) => setGame((g) => renameUnit(g, unitId, callsign)),
        removeUnit: (unitId) => setGame((g) => removeUnit(g, unitId)),

        async dispatch(missionId, unitIds) {
          const { game, settings, ui } = get();
          const mission = game.missions[missionId];
          if (!mission) return;
          const ids = unitIds.filter((id) => game.units[id] && isAvailable(game.units[id]!) && !ui.busy[id]);
          if (ids.length === 0) return;
          setBusy(ids, true);
          try {
            const routes = await Promise.all(
              ids.map((id) => getRoute(unitPosition(game.units[id]!, game.clock), mission.position, settings.roadRouting)),
            );
            // Commit against the *current* state; dispatchUnit ignores units
            // that became unavailable while we were routing.
            setGame((g) => ids.reduce((acc, id, i) => dispatchUnit(acc, id, missionId, routes[i]!), g));
          } finally {
            setBusy(ids, false);
          }
        },

        async releaseUnit(unitId) {
          if (get().ui.busy[unitId]) return;
          setBusy([unitId], true);
          try {
            const routes = await routesHome([unitId]);
            setGame((g) => releaseUnit(g, unitId, routes[unitId] ?? null));
          } finally {
            setBusy([unitId], false);
          }
        },

        async closeMission(missionId, outcome) {
          const mission = get().game.missions[missionId];
          if (!mission || get().ui.busy[missionId]) return;
          setBusy([missionId], true);
          try {
            const routes = await routesHome(mission.assignedUnitIds);
            setGame((g) => closeMission(g, missionId, outcome, routes));
            if (get().ui.selectedMissionId === missionId && !get().game.missions[missionId]) {
              patchUi({ selectedMissionId: null });
            }
          } finally {
            setBusy([missionId], false);
          }
        },
      };
    },
    {
      name: 'reds-save',
      version: 3,
      storage: createJSONStorage(() => throttledLocalStorage),
      partialize: (s) => ({ game: s.game, speed: s.speed, settings: s.settings }),
      // v1 → v2 (Milestone 2): added dispatch centers. Put every pre-existing
      // station into one legacy center so old saves keep working unchanged.
      // v2 → v3: Trip gained cumTime (lets speed vary by road segment
      // instead of being one flat trip-average — see sim/geo.ts). A unit
      // mid-trip in an old save has a trip with no cumTime at all, which
      // crashes the whole app on load (every render reads it); rebuild it
      // with the old constant-speed split so that trip finishes exactly as
      // it would have before this existed.
      migrate: (persisted, version) => {
        const p = persisted as { game: GameState; speed: Speed; settings: Settings };
        if (version < 2 && p.game && !p.game.dispatchCenters) {
          const centerId = 'dc-legacy';
          p.game.dispatchCenters = { [centerId]: { id: centerId, name: 'Dispatch Center 1' } };
          for (const station of Object.values(p.game.stations ?? {})) (station as Station).centerId = centerId;
          p.game.version = 2;
        }
        if (version < 3 && p.game) {
          for (const unit of Object.values(p.game.units ?? {})) {
            const trip = unit.trip as (typeof unit.trip & { cumTime?: number[] }) | null;
            if (trip && !trip.cumTime) {
              trip.cumTime = buildCumTime(trip.cumDist, undefined, Math.max(1, trip.arriveAt - trip.departAt));
            }
          }
        }
        return p;
      },
    },
  ),
);
