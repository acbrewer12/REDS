import { describe, expect, it } from 'vitest';
import { getSpec } from './data/apparatus';
import { getMissionType } from './data/missions';
import { FLEET_PRESETS, FLEET_PRESETS_BY_ID } from './data/presets';
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
  eligibleMissionTypes,
  estimateRoute,
  isAvailable,
  nearestDispatchCenter,
  pickPatrolWaypoint,
  planCall,
  releaseUnit,
  removeStation,
  stationsDueForCall,
  stationsInCenter,
  tick,
  unitPosition,
  unitSpeedMph,
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

  it('reports a unit\'s live speed only while it is actually rolling', () => {
    let { state, stationId } = setup();
    const added = addMission(
      state,
      { stationId, typeId: 'grass-fire', position: SCENE, narrative: 'test', workRequiredSec: 600 },
      'Hwy 32, Salem',
    );
    state = added.state;
    const brush = unitBy(state, 'Brush 8018');
    expect(unitSpeedMph(state.units[brush.id]!, state.clock)).toBe(0);

    state = dispatchUnit(state, brush.id, added.missionId, estimateRoute(SALEM, SCENE));
    // Still turning out at the station: not rolling yet.
    expect(unitSpeedMph(state.units[brush.id]!, state.clock)).toBe(0);

    state = tick(state, 301_000); // past the 5-minute volunteer turnout
    expect(state.units[brush.id]!.status).toBe('en_route');
    // The straight-line path drawn (no circuity) covered in the time
    // budgeted for a circuity-inflated road distance, scaled by the unit's
    // own road-time factor — same math `dispatchUnit`/`makeTrip` use.
    const roadTimeFactor = getSpec(state.units[brush.id]!.specId).roadTimeFactor;
    const expectedMph = haversineMeters(SALEM, SCENE) / (estimateRoute(SALEM, SCENE).carDurationSec * roadTimeFactor) / 0.44704;
    expect(unitSpeedMph(state.units[brush.id]!, state.clock)).toBeCloseTo(expectedMph, 5);

    state = runUntil(state, (s) => s.units[brush.id]!.status === 'on_scene');
    expect(unitSpeedMph(state.units[brush.id]!, state.clock)).toBe(0);
  });

  it('drives idle patrol units at the posted limit, and pulls one off its beat with no turnout when a call comes in', () => {
    let { state, stationId, rng } = setup('salem-pd');
    const unit = unitBy(state, 'Unit 1');
    expect(canPatrol(unit)).toBe(true);
    expect(unit.status).toBe('in_quarters');

    const station = state.stations[stationId]!;
    const waypoint = pickPatrolWaypoint(station, rng);
    expect(haversineMeters(station.position, waypoint)).toBeLessThanOrEqual(station.responseRadiusKm * 1000 + 1);

    const route = estimateRoute(SALEM, waypoint);
    state = beginPatrol(state, unit.id, route, waypoint);
    let u = state.units[unit.id]!;
    expect(u.status).toBe('patrolling');
    expect(isAvailable(u)).toBe(true); // still assignable while out on the beat

    // Legal speed: Math.max(1, roadTimeFactor) — never the <1 code-3 boost
    // a real dispatch gets — so this is slower (or equal) than an emergency
    // response over the same route.
    const spec = getSpec(unit.specId);
    const dispatchTravelSec = route.carDurationSec * spec.roadTimeFactor;
    const patrolTravelSec = route.carDurationSec * Math.max(1, spec.roadTimeFactor);
    expect(patrolTravelSec).toBeGreaterThanOrEqual(dispatchTravelSec);
    expect(u.trip!.arriveAt - u.trip!.departAt).toBeCloseTo(Math.max(1, patrolTravelSec) * 1000, 0);
    expect(unitSpeedMph(u, state.clock + 1000)).toBeGreaterThan(0);

    // Finishing a leg clears the trip but keeps the unit out and available —
    // the engine can't pick the next random waypoint (needs rng), so it
    // just waits there for the caller to start another leg.
    state = tick(state, u.trip!.arriveAt - u.trip!.departAt);
    u = state.units[unit.id]!;
    expect(u.status).toBe('patrolling');
    expect(u.trip).toBeNull();
    expect(haversineMeters(u.position, waypoint)).toBeLessThan(1);

    // A call comes in: the patrolling unit is pulled off its beat from
    // wherever it is now, with zero turnout — it's already rolling.
    const added = addMission(
      state,
      { stationId, typeId: 'suspicious-vehicle', position: SCENE, narrative: '', workRequiredSec: 300 },
      'x',
    );
    state = dispatchUnit(added.state, unit.id, added.missionId, estimateRoute(waypoint, SCENE));
    u = state.units[unit.id]!;
    expect(u.status).toBe('en_route'); // no 'dispatched' turnout phase
    expect(u.trip!.departAt).toBe(state.clock);
  });

  it("reads a unit's live speed off the actual road segment, not a flat trip-average", () => {
    // A road route with real per-segment timing: a slow residential leg out
    // of the station, then a fast open stretch — the kind of data OSRM's
    // annotations=true gives, which a flat trip-average washes out into one
    // number (the "25 in a 35 zone" complaint this fixes).
    let { state, stationId } = setup('salem-pd');
    const unit = unitBy(state, 'Unit 1');
    // Due north along the same meridian, so the two legs are exactly
    // equal-length (isolates the timing ratio from any distance skew).
    const mid = { lat: SALEM.lat + 0.05, lng: SALEM.lng };
    const scene = { lat: SALEM.lat + 0.1, lng: SALEM.lng };
    const legDistM = haversineMeters(SALEM, mid);
    const route = {
      path: [SALEM, mid, scene],
      distanceM: legDistM * 2,
      carDurationSec: 500, // unused once segDurationsSec is supplied
      source: 'road' as const,
      segDurationsSec: [300, 60], // residential leg takes 5x as long as the open one
    };

    const added = addMission(
      state,
      { stationId, typeId: 'suspicious-vehicle', position: scene, narrative: '', workRequiredSec: 300 },
      'x',
    );
    state = dispatchUnit(added.state, unit.id, added.missionId, route);
    state = tick(state, 31_000); // past the 30s police turnout
    expect(state.units[unit.id]!.status).toBe('en_route');

    const trip = state.units[unit.id]!.trip!;
    // trip.path is [from, ...route.path, to]; here from/to equal route's own
    // endpoints, so it's [SALEM, SALEM, mid, SCENE, SCENE] — the real legs
    // are cumTime[1..2] (SALEM→mid) and cumTime[2..3] (mid→SCENE), either
    // side of the (near-zero-width) duplicate-endpoint stub segments.
    const halfwayThroughLeg1 = state.clock + trip.cumTime[1]! + (trip.cumTime[2]! - trip.cumTime[1]!) / 2;
    const halfwayThroughLeg2 = state.clock + trip.cumTime[2]! + (trip.cumTime[3]! - trip.cumTime[2]!) / 2;
    const slowLegMph = unitSpeedMph(state.units[unit.id]!, halfwayThroughLeg1);
    const fastLegMph = unitSpeedMph(state.units[unit.id]!, halfwayThroughLeg2);
    expect(slowLegMph).toBeGreaterThan(0);
    // Same leg distance, 5x the time → the open stretch reads ~5x faster,
    // not the one blended number a trip-average would give throughout.
    expect(fastLegMph / slowLegMph).toBeCloseTo(5, 1);
  });

  it('drives the posted limit for a non-emergency call type, not the code-3 boost', () => {
    let { state, stationId } = setup('salem-pd');
    const route = estimateRoute(SALEM, SCENE);

    // 'alarm-burglary' is marked emergencyResponse: false — an unverified
    // alarm, standard procedure is a routine response.
    const hot = addMission(state, { stationId, typeId: 'suspicious-vehicle', position: SCENE, narrative: '', workRequiredSec: 300 }, 'x');
    expect(getMissionType('suspicious-vehicle').emergencyResponse).toBe(false);
    // 'disturbance' has no emergencyResponse set — defaults to true (hot).
    expect(getMissionType('disturbance').emergencyResponse).toBeUndefined();

    const unit = unitBy(state, 'Unit 1');
    const spec = getSpec(unit.specId);
    expect(spec.roadTimeFactor).toBeLessThan(1); // this unit *can* run faster than traffic...

    const routineState = dispatchUnit(hot.state, unit.id, hot.missionId, route);
    const routineTrip = routineState.units[unit.id]!.trip!;
    const routineTravelSec = (routineTrip.arriveAt - routineTrip.departAt) / 1000;
    // ...but not here: never faster than the route's own baseline pace.
    expect(routineTravelSec).toBeGreaterThanOrEqual(route.carDurationSec - 1e-6);

    // Dispatched to a call with no emergencyResponse override (hot by
    // default), the same unit over the same route gets the code-3 boost —
    // strictly faster (shorter travel time) than the routine response above.
    const added2 = addMission(state, { stationId, typeId: 'disturbance', position: SCENE, narrative: '', workRequiredSec: 300 }, 'x');
    const hotState = dispatchUnit(added2.state, unit.id, added2.missionId, route);
    const hotTrip = hotState.units[unit.id]!.trip!;
    const hotTravelSec = (hotTrip.arriveAt - hotTrip.departAt) / 1000;
    expect(hotTravelSec).toBeLessThan(routineTravelSec);
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

describe('engine — auto-dispatch candidate ranking (Milestone 3)', () => {
  /** Two engines and one lone brush truck, all in quarters at the same station. */
  function setupGrassFire() {
    const rng = mulberry32(9);
    const { state: withCenter, centerId } = addDispatchCenter(createGame(Date.UTC(2026, 9, 5, 14)), 'Salem Dispatch');
    let { state, stationId } = addStation(
      withCenter,
      {
        name: 'Test FPD',
        discipline: 'fire',
        address: 'Salem, MO',
        position: SALEM,
        staffing: 'volunteer',
        responseRadiusKm: 15,
        centerId,
      },
      rng,
    );
    state = addUnit(state, stationId, 'engine-t1', 'Engine A');
    state = addUnit(state, stationId, 'engine-t1', 'Engine B');
    state = addUnit(state, stationId, 'engine-t6', 'Brush 1'); // the only brush truck
    // All units start at the station, so a mission there gives every unit
    // the same (zero) travel distance and the same turnout — a clean tie.
    const added = addMission(state, { stationId, typeId: 'grass-fire', position: SALEM, narrative: '', workRequiredSec: 600 }, 'Salem, MO');
    return { state: added.state, missionId: added.missionId };
  }

  it('prefers a unit with backup over a center’s sole cover for its role, all else equal', () => {
    const { state, missionId } = setupGrassFire();
    const ranked = candidatesForMission(state, state.missions[missionId]!).map((c) => c.unit.callsign);
    // Brush 1 is the best *suited* unit for a grass fire (primary role), but
    // it's the only brush truck in the center, so coverage pushes it behind
    // the two engines, which have each other as backup.
    expect(ranked).toEqual(['Engine A', 'Engine B', 'Brush 1']);
  });

  it('still recommends the sole-cover unit when nothing else can fill the slot', () => {
    const { state, missionId } = setupGrassFire();
    const mission = state.missions[missionId]!;
    // Pull both engines out of quarters (dispatch them elsewhere), leaving
    // only the brush truck available.
    const engineA = Object.values(state.units).find((u) => u.callsign === 'Engine A')!.id;
    const engineB = Object.values(state.units).find((u) => u.callsign === 'Engine B')!.id;
    let s = dispatchUnit(state, engineA, mission.id, estimateRoute(SALEM, SALEM));
    s = dispatchUnit(s, engineB, mission.id, estimateRoute(SALEM, SALEM));
    const ranked = candidatesForMission(s, mission).map((c) => c.unit.callsign);
    expect(ranked).toEqual(['Brush 1']);
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

describe('engine — fleet presets (every region)', () => {
  it('resolves every unit in every preset to a real apparatus spec', () => {
    for (const preset of FLEET_PRESETS) {
      for (const u of preset.units) expect(() => getSpec(u.specId), `${preset.id}: ${u.callsign}`).not.toThrow();
    }
  });

  it('every non-empty preset is coverable by its own fleet and only generates matching-discipline calls', () => {
    for (const preset of FLEET_PRESETS) {
      if (preset.units.length === 0) continue;
      const rng = mulberry32(5);
      const { state: withCenter, centerId } = addDispatchCenter(createGame(0), `${preset.id} Dispatch`);
      let { state, stationId } = addStation(
        withCenter,
        {
          name: preset.stationName,
          discipline: preset.discipline,
          address: 'test',
          position: SALEM,
          staffing: preset.staffing,
          responseRadiusKm: preset.responseRadiusKm,
          centerId,
        },
        rng,
      );
      for (const u of preset.units) state = addUnit(state, stationId, u.specId, u.callsign);

      const types = eligibleMissionTypes(state, state.stations[stationId]!);
      expect(types.length, `${preset.id} should be able to generate at least one call type`).toBeGreaterThan(0);
      for (const t of types) expect(t.discipline, `${preset.id}: ${t.id}`).toBe(preset.discipline);
    }
  });
});
