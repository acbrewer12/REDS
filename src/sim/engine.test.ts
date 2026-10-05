import { describe, expect, it } from 'vitest';
import { FLEET_PRESETS_BY_ID } from './data/presets';
import {
  addMission,
  addStation,
  addUnit,
  closeMission,
  createGame,
  dispatchUnit,
  eligibleMissionTypes,
  estimateRoute,
  planCall,
  releaseUnit,
  stationsDueForCall,
  tick,
  unitPosition,
} from './engine';
import { haversineMeters } from './geo';
import { mulberry32 } from './rng';
import type { GameState } from './types';

const SALEM = { lat: 37.6456, lng: -91.5357 };
const SCENE = { lat: 37.66, lng: -91.52 };

function setup(presetId = 'dent-county-fpd') {
  const rng = mulberry32(7);
  const preset = FLEET_PRESETS_BY_ID[presetId]!;
  let { state, stationId } = addStation(
    createGame(Date.UTC(2026, 9, 5, 14)),
    {
      name: preset.stationName,
      discipline: preset.discipline,
      address: '2 S Main St, Salem, MO',
      position: SALEM,
      staffing: preset.staffing,
      responseRadiusKm: preset.responseRadiusKm,
    },
    rng,
  );
  for (const u of preset.units) state = addUnit(state, stationId, u.specId, u.callsign);
  return { state, stationId, rng };
}

const unitBy = (s: GameState, callsign: string) => Object.values(s.units).find((u) => u.callsign === callsign)!;

/** Advance in 1 s steps (like the UI loop) until `pred` holds. */
function runUntil(s: GameState, pred: (s: GameState) => boolean, maxSec = 6 * 3600): GameState {
  for (let i = 0; i < maxSec && !pred(s); i++) s = tick(s, 1000);
  if (!pred(s)) throw new Error('condition never reached');
  return s;
}

describe('engine — single-station loop', () => {
  it('only generates calls the fleet can handle', () => {
    const { state, stationId } = setup('small-town-pd');
    const types = eligibleMissionTypes(state, state.stations[stationId]!).map((t) => t.discipline);
    expect(new Set(types)).toEqual(new Set(['police']));

    const fire = setup('rural-fire-basic');
    const ids = eligibleMissionTypes(fire.state, fire.state.stations[fire.stationId]!).map((t) => t.id);
    expect(ids).toContain('grass-fire');
    expect(ids).not.toContain('chimney-fire'); // no ladder in this fleet
    expect(ids).not.toContain('ems-fall'); // no ambulance
  });

  it('schedules the first call shortly after a station opens', () => {
    let { state, stationId, rng } = setup();
    expect(stationsDueForCall(state)).toHaveLength(0);
    state = runUntil(state, (s) => stationsDueForCall(s).length > 0, 120);
    const { state: s2, plan } = planCall(state, stationId, rng);
    expect(plan).not.toBeNull();
    expect(haversineMeters(SALEM, plan!.position)).toBeLessThanOrEqual(12_000 + 1);
    expect(stationsDueForCall(s2)).toHaveLength(0);
  });

  it('runs a call from dispatch to completion', () => {
    let { state, stationId } = setup();
    const added = addMission(
      state,
      { stationId, typeId: 'grass-fire', position: SCENE, narrative: 'test', workRequiredSec: 600 },
      'Hwy 32, Salem',
    );
    state = added.state;
    const missionId = added.missionId;
    expect(state.missions[missionId]!.status).toBe('pending');

    const brush = unitBy(state, 'Brush 1');
    state = dispatchUnit(state, brush.id, missionId, estimateRoute(SALEM, SCENE));
    expect(state.units[brush.id]!.status).toBe('dispatched');
    expect(state.missions[missionId]!.status).toBe('dispatched');

    // Volunteer turnout: 5 minutes before the truck rolls.
    state = tick(state, 299_000);
    expect(state.units[brush.id]!.status).toBe('dispatched');
    state = tick(state, 2000);
    expect(state.units[brush.id]!.status).toBe('en_route');
    const moving = unitPosition(state.units[brush.id]!, state.clock + 30_000);
    expect(haversineMeters(SALEM, moving)).toBeGreaterThan(0);

    state = runUntil(state, (s) => s.units[brush.id]!.status === 'on_scene');
    expect(state.units[brush.id]!.position).toEqual(SCENE);
    state = tick(state, 1000);
    expect(state.missions[missionId]!.status).toBe('working');

    // Can't clear until the work is done.
    expect(closeMission(state, missionId, 'completed')).toBe(state);
    state = runUntil(state, (s) => s.missions[missionId]!.status === 'resolved');

    state = closeMission(state, missionId, 'completed');
    expect(state.missions[missionId]).toBeUndefined();
    expect(state.credits).toBe(300);
    expect(state.stats.completed).toBe(1);
    expect(state.units[brush.id]!.status).toBe('returning');

    state = runUntil(state, (s) => s.units[brush.id]!.status === 'in_quarters');
    expect(state.units[brush.id]!.position).toEqual(SALEM);
    expect(state.units[brush.id]!.missionId).toBeNull();
  });

  it('pauses work when a required unit leaves the scene', () => {
    let { state, stationId } = setup();
    const added = addMission(
      state,
      { stationId, typeId: 'vehicle-fire', position: SCENE, narrative: '', workRequiredSec: 900 },
      'somewhere',
    );
    state = added.state;
    const engine = unitBy(state, 'Engine 8010');
    state = dispatchUnit(state, engine.id, added.missionId, estimateRoute(SALEM, SCENE));
    state = runUntil(state, (s) => s.missions[added.missionId]!.status === 'working');
    state = tick(state, 60_000);
    const done = state.missions[added.missionId]!.workDoneSec;
    expect(done).toBeGreaterThan(0);

    state = releaseUnit(state, engine.id, null);
    state = tick(state, 60_000);
    expect(state.missions[added.missionId]!.status).toBe('pending');
    expect(state.missions[added.missionId]!.workDoneSec).toBe(done);
  });

  it('redirects a returning unit without turnout time', () => {
    let { state, stationId } = setup();
    const a = addMission(state, { stationId, typeId: 'fire-alarm', position: SCENE, narrative: '', workRequiredSec: 60 }, 'A');
    state = a.state;
    const engine = unitBy(state, 'Engine 8010');
    state = dispatchUnit(state, engine.id, a.missionId, estimateRoute(SALEM, SCENE));
    state = runUntil(state, (s) => s.missions[a.missionId]!.status === 'resolved');
    state = closeMission(state, a.missionId, 'completed');
    state = tick(state, 30_000);
    expect(state.units[engine.id]!.status).toBe('returning');

    const b = addMission(state, { stationId, typeId: 'fire-alarm', position: SALEM, narrative: '', workRequiredSec: 60 }, 'B');
    state = b.state;
    const from = unitPosition(state.units[engine.id]!, state.clock);
    state = dispatchUnit(state, engine.id, b.missionId, estimateRoute(from, SALEM));
    expect(state.units[engine.id]!.status).toBe('en_route');
  });

  it('cancelling a call sends units home and pays nothing', () => {
    let { state, stationId } = setup();
    const a = addMission(state, { stationId, typeId: 'grass-fire', position: SCENE, narrative: '', workRequiredSec: 600 }, 'A');
    state = a.state;
    const brush = unitBy(state, 'Brush 1');
    state = dispatchUnit(state, brush.id, a.missionId, estimateRoute(SALEM, SCENE));
    state = closeMission(state, a.missionId, 'cancelled');
    expect(state.units[brush.id]!.status).toBe('in_quarters'); // was still turning out
    expect(state.credits).toBe(0);
    expect(state.stats.cancelled).toBe(1);
  });
});
