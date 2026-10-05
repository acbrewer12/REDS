import { describe, expect, it } from 'vitest';
import { FLEET_PRESETS_BY_ID } from './data/presets';
import {
  addDispatchCenter,
  addMission,
  addStation,
  addUnit,
  closeMission,
  createGame,
  dispatchUnit,
  eligibleMissionTypes,
  estimateRoute,
  nearestDispatchCenter,
  planCall,
  releaseUnit,
  removeStation,
  stationsDueForCall,
  stationsInCenter,
  tick,
  unitPosition,
  unitsInCenter,
} from './engine';
import { haversineMeters } from './geo';
import { mulberry32 } from './rng';
import type { GameState } from './types';

const SALEM = { lat: 37.6456, lng: -91.5357 };
const SCENE = { lat: 37.66, lng: -91.52 };
const ANCHORAGE = { lat: 61.2181, lng: -149.9003 };

function setup(presetId = 'dent-county-fpd') {
  const rng = mulberry32(7);
  const preset = FLEET_PRESETS_BY_ID[presetId]!;
  const game0 = createGame(Date.UTC(2026, 9, 5, 14));
  const { state: withCenter, centerId } = addDispatchCenter(game0, 'Salem Dispatch');
  let { state, stationId } = addStation(
    withCenter,
    {
      name: preset.stationName,
      discipline: preset.discipline,
      address: '2 S Main St, Salem, MO',
      position: SALEM,
      staffing: preset.staffing,
      responseRadiusKm: preset.responseRadiusKm,
      centerId,
    },
    rng,
  );
  for (const u of preset.units) state = addUnit(state, stationId, u.specId, u.callsign);
  return { state, stationId, centerId, rng };
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

    const brush = unitBy(state, 'Brush 8018');
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
    const brush = unitBy(state, 'Brush 8018');
    state = dispatchUnit(state, brush.id, a.missionId, estimateRoute(SALEM, SCENE));
    state = closeMission(state, a.missionId, 'cancelled');
    expect(state.units[brush.id]!.status).toBe('in_quarters'); // was still turning out
    expect(state.credits).toBe(0);
    expect(state.stats.cancelled).toBe(1);
  });
});

describe('engine — multi-region dispatch centers (Milestone 2)', () => {
  /** A second, unrelated region far away, in its own dispatch center. */
  function addAlaska(state: GameState) {
    const { state: s1, centerId } = addDispatchCenter(state, 'Alaska Dispatch');
    const preset = FLEET_PRESETS_BY_ID['salem-pd']!;
    const { state: s2, stationId } = addStation(
      s1,
      {
        name: 'Anchorage PD',
        discipline: 'police',
        address: 'Anchorage, AK',
        position: ANCHORAGE,
        staffing: 'career',
        responseRadiusKm: 10,
        centerId,
      },
      mulberry32(1),
    );
    let s3 = s2;
    for (const u of preset.units) s3 = addUnit(s3, stationId, u.specId, u.callsign);
    return { state: s3, centerId, stationId };
  }

  it('keeps each center its own unit pool for call eligibility', () => {
    const { state, stationId } = setup('salem-pd'); // fire station becomes police for this test's shape
    const { state: withAlaska, stationId: akStationId } = addAlaska(state);

    // Salem's eligible calls come only from Salem's own fleet (a lone patrol car).
    const salemTypes = eligibleMissionTypes(withAlaska, withAlaska.stations[stationId]!).map((t) => t.id);
    expect(salemTypes).toContain('suspicious-vehicle');
    expect(salemTypes).not.toContain('disturbance'); // needs 2 patrol units; Salem only has 1

    // Anchorage has its own single-unit fleet too, isolated from Salem's.
    const akTypes = eligibleMissionTypes(withAlaska, withAlaska.stations[akStationId]!).map((t) => t.id);
    expect(akTypes).toContain('suspicious-vehicle');
    expect(akTypes).not.toContain('disturbance');
  });

  it('pools units across stations that share one dispatch center', () => {
    const { state, stationId, centerId } = setup('salem-pd');
    // A second Salem-area station joins the SAME center.
    const { state: s2, stationId: station2 } = addStation(
      state,
      {
        name: 'Salem PD Unit 2 House',
        discipline: 'police',
        address: 'Salem, MO',
        position: { lat: SALEM.lat + 0.01, lng: SALEM.lng },
        staffing: 'career',
        responseRadiusKm: 6,
        centerId,
      },
      mulberry32(2),
    );
    const s3 = addUnit(s2, station2, 'patrol-suv', 'Unit 2');

    expect(stationsInCenter(s3, centerId)).toHaveLength(2);
    expect(unitsInCenter(s3, centerId)).toHaveLength(2);
    // Pooled across both stations, the center can now field a 2-unit call.
    const types = eligibleMissionTypes(s3, s3.stations[stationId]!).map((t) => t.id);
    expect(types).toContain('disturbance');
  });

  it('never lets one region generate calls its own fleet cannot cover, even with a distant region fully staffed', () => {
    const { state, stationId } = setup('career-fire'); // big, capable fleet
    const { state: withAlaska, stationId: akStationId } = addAlaska(state);
    // Anchorage (police, no fire apparatus at all) must not pick up fire-only call types.
    const akTypes = eligibleMissionTypes(withAlaska, withAlaska.stations[akStationId]!).map((t) => t.id);
    expect(akTypes.every((id) => !['grass-fire', 'structure-fire-residential', 'chimney-fire'].includes(id))).toBe(true);
    // And Salem's own capable fleet is untouched by Anchorage's presence.
    const salemTypes = eligibleMissionTypes(withAlaska, withAlaska.stations[stationId]!).map((t) => t.id);
    expect(salemTypes).toContain('chimney-fire');
  });

  it('suggests joining a nearby center but not a distant one', () => {
    const { state, centerId } = setup();
    const nearby = nearestDispatchCenter(state, { lat: SALEM.lat + 0.1, lng: SALEM.lng });
    expect(nearby?.centerId).toBe(centerId);
    const farAway = nearestDispatchCenter(state, ANCHORAGE);
    expect(farAway).toBeNull();
  });

  it('removing the last station in a center drops the empty center', () => {
    const { state, stationId, centerId } = setup('empty'); // no units, so removal is allowed
    expect(state.dispatchCenters[centerId]).toBeDefined();
    const after = removeStation(state, stationId);
    expect(after.stations[stationId]).toBeUndefined();
    expect(after.dispatchCenters[centerId]).toBeUndefined();
  });

  it('rejects a station placed in an unknown dispatch center', () => {
    const { state } = setup();
    expect(() =>
      addStation(
        state,
        {
          name: 'Ghost Station',
          discipline: 'fire',
          address: 'nowhere',
          position: SALEM,
          staffing: 'volunteer',
          responseRadiusKm: 5,
          centerId: 'does-not-exist',
        },
        mulberry32(3),
      ),
    ).toThrow();
  });
});
