import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { FLEET_PRESETS_BY_ID } from './sim/data/presets';
import {
  addDispatchCenter,
  addMission,
  addStation,
  addUnit,
  closeMission,
  createGame,
  dispatchUnit,
  isAvailable,
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

      return {
        game: createGame(Date.now()),
        speed: 1,
        settings: { roadRouting: true, autoClear: false, baseLayer: 'streets' },
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
      version: 2,
      storage: createJSONStorage(() => throttledLocalStorage),
      partialize: (s) => ({ game: s.game, speed: s.speed, settings: s.settings }),
      // v1 → v2 (Milestone 2): added dispatch centers. Put every pre-existing
      // station into one legacy center so old saves keep working unchanged.
      migrate: (persisted, version) => {
        const p = persisted as { game: GameState; speed: Speed; settings: Settings };
        if (version < 2 && p.game && !p.game.dispatchCenters) {
          const centerId = 'dc-legacy';
          p.game.dispatchCenters = { [centerId]: { id: centerId, name: 'Dispatch Center 1' } };
          for (const station of Object.values(p.game.stations ?? {})) (station as Station).centerId = centerId;
          p.game.version = 2;
        }
        return p;
      },
    },
  ),
);
