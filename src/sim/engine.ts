// The simulation engine: pure functions from GameState to GameState.
// No React, no network, no Date.now() — callers pass in routes and RNG — so
// it can be unit-tested, replayed, or moved server-side later.

import { getSpec } from './data/apparatus';
import { getMissionType, MISSION_TYPES } from './data/missions';
import { POLICE_TURNOUT_SECONDS, TURNOUT_SECONDS } from './data/presets';
import { cumulativeDistances, haversineMeters, randomPointInRadius, tripPosition } from './geo';
import { matchRequirements, rankCandidates } from './requirements';
import type {
  Discipline,
  GameState,
  LatLng,
  LogKind,
  Mission,
  MissionType,
  StaffingModel,
  Station,
  Trip,
  Unit,
} from './types';

/** A new dispatch center farther than this from every existing one won't be auto-suggested for mutual aid. */
export const MUTUAL_AID_SUGGEST_KM = 150;

/** Mean sim-seconds between calls in one station's area. */
export const CALL_INTERVAL_SEC = 300;
/** A station's area stops generating calls while this many are open. */
export const MAX_OPEN_CALLS_PER_STATION = 4;
/** Road circuity factor applied to straight-line distance when no road route is available. */
export const ESTIMATE_CIRCUITY = 1.35;
/** Average passenger-car speed on mixed rural roads, for straight-line estimates. */
export const ESTIMATE_CAR_KPH = 64;
/** Non-emergency return trips run slower than a lights-and-siren response. */
export const RETURN_TIME_FACTOR = 1.15;
const LOG_LIMIT = 300;

/** A drivable path between two points, as a passenger car would drive it. */
export interface Route {
  path: LatLng[];
  distanceM: number;
  carDurationSec: number;
  source: 'road' | 'estimate';
}

export function createGame(epoch: number): GameState {
  return {
    version: 2,
    epoch,
    clock: 0,
    dispatchCenters: {},
    stations: {},
    units: {},
    missions: {},
    log: [],
    credits: 0,
    stats: { completed: 0, cancelled: 0 },
    seq: 0,
  };
}

// ── helpers ────────────────────────────────────────────────────────────

/** Shallow-copy the collections so callers can replace entries without mutating `state`. */
function draft(state: GameState): GameState {
  return {
    ...state,
    dispatchCenters: { ...state.dispatchCenters },
    stations: { ...state.stations },
    units: { ...state.units },
    missions: { ...state.missions },
    log: [...state.log],
    stats: { ...state.stats },
  };
}

function newId(s: GameState, prefix: string): string {
  s.seq += 1;
  return `${prefix}${s.seq.toString(36)}`;
}

function log(s: GameState, kind: LogKind, text: string, missionId?: string, t = s.clock) {
  const id = (s.log.at(-1)?.id ?? 0) + 1;
  s.log.push({ id, t, kind, text, missionId });
  if (s.log.length > LOG_LIMIT) s.log.splice(0, s.log.length - LOG_LIMIT);
}

/** Straight-line route with a road-circuity allowance, used when no router is available. */
export function estimateRoute(from: LatLng, to: LatLng): Route {
  const distanceM = haversineMeters(from, to) * ESTIMATE_CIRCUITY;
  return {
    path: [from, to],
    distanceM,
    carDurationSec: distanceM / ((ESTIMATE_CAR_KPH * 1000) / 3600),
    source: 'estimate',
  };
}

export function turnoutSeconds(staffing: StaffingModel, discipline: Discipline): number {
  return discipline === 'police' ? POLICE_TURNOUT_SECONDS : TURNOUT_SECONDS[staffing];
}

export function unitPosition(unit: Unit, t: number): LatLng {
  return unit.trip ? tripPosition(unit.trip, t) : unit.position;
}

/**
 * A moving unit's current road speed in mph, for display only — the
 * simulation itself only needs average speed (constant across one trip; see
 * `tripPosition`), so this is that same trip-average number, zero while the
 * unit isn't actually rolling (turning out, on scene, in quarters).
 */
export function unitSpeedMph(unit: Unit, t: number): number {
  const trip = unit.trip;
  if (!trip || t < trip.departAt || t >= trip.arriveAt) return 0;
  const distanceM = trip.cumDist.at(-1) ?? 0;
  const durationSec = (trip.arriveAt - trip.departAt) / 1000;
  if (durationSec <= 0) return 0;
  return distanceM / durationSec / 0.44704; // m/s → mph
}

/** Units in quarters, or driving home, can take a new assignment. */
export function isAvailable(unit: Unit): boolean {
  return unit.status === 'in_quarters' || unit.status === 'returning';
}

/** Seconds from dispatch until this unit would arrive via `route`. */
export function etaSeconds(state: GameState, unit: Unit, route: Route): number {
  const station = state.stations[unit.stationId]!;
  const spec = getSpec(unit.specId);
  const turnout = unit.status === 'in_quarters' ? turnoutSeconds(station.staffing, spec.discipline) : 0;
  return turnout + route.carDurationSec * spec.roadTimeFactor;
}

function makeTrip(route: Route, from: LatLng, to: LatLng, departAt: number, travelSec: number): Trip {
  // Routers snap endpoints to the nearest road; pin the path to the real
  // start/end so the marker leaves the station and stops on the incident.
  const path = [from, ...route.path, to];
  return {
    path,
    cumDist: cumulativeDistances(path),
    departAt,
    arriveAt: departAt + Math.max(1, travelSec) * 1000,
    source: route.source,
  };
}

export function missionType(m: Mission): MissionType {
  return getMissionType(m.typeId);
}

export function missionUnits(state: GameState, m: Mission): Unit[] {
  return m.assignedUnitIds.map((id) => state.units[id]).filter((u): u is Unit => !!u);
}

export function isOpen(m: Mission): boolean {
  return m.status !== 'completed' && m.status !== 'cancelled';
}

export interface DispatchCandidate {
  unit: Unit;
  etaSec: number;
  distanceM: number;
}

/**
 * Units available to respond to a mission, scoped to its dispatch center
 * (a unit housed in an unrelated, far-away region never shows up), ranked
 * closest/best-suited first using straight-line ETA estimates — fast enough
 * to run every tick; a real road ETA is only fetched once a dispatch is
 * confirmed.
 *
 * Within an ETA/suitability tier, a unit that is the *only* available cover
 * for one of its roles in the center is pushed to the back. That alone
 * keeps both "Select recommended" and the auto-dispatch AI from reflexively
 * grabbing a district's last brush truck for a borderline call — they'll
 * still take it if nothing else can cover the slot, just not before trying
 * every unit that has backup.
 */
export function candidatesForMission(state: GameState, mission: Mission): DispatchCandidate[] {
  const centerId = state.stations[mission.stationId]?.centerId;
  const pool = Object.values(state.units).filter(
    (unit) => isAvailable(unit) && (!centerId || state.stations[unit.stationId]?.centerId === centerId),
  );
  const roleAvailability = new Map<string, number>();
  for (const unit of pool) {
    for (const role of getSpec(unit.specId).roles) roleAvailability.set(role, (roleAvailability.get(role) ?? 0) + 1);
  }
  const isSoleCover = (unit: Unit) => getSpec(unit.specId).roles.some((r) => roleAvailability.get(r) === 1);

  const candidates = pool.map((unit) => {
    const from = unitPosition(unit, state.clock);
    const route = estimateRoute(from, mission.position);
    return { unit, etaSec: etaSeconds(state, unit, route), distanceM: haversineMeters(from, mission.position) };
  });
  const ranked = rankCandidates(missionType(mission), candidates);
  // Array.prototype.sort is stable, so this only reorders across the sole/not-sole
  // boundary and leaves the existing ETA/suitability order intact within each group.
  return [...ranked].sort((a, b) => Number(isSoleCover(a.unit)) - Number(isSoleCover(b.unit)));
}

// ── dispatch centers ───────────────────────────────────────────────────

/** Create a new, empty dispatch center (a region's independent call/unit pool). */
export function addDispatchCenter(state: GameState, name: string): { state: GameState; centerId: string } {
  const s = draft(state);
  const id = newId(s, 'dc');
  s.dispatchCenters[id] = { id, name: name.trim() || 'Dispatch Center' };
  return { state: s, centerId: id };
}

export function renameDispatchCenter(state: GameState, centerId: string, name: string): GameState {
  const center = state.dispatchCenters[centerId];
  if (!center || !name.trim()) return state;
  const s = draft(state);
  s.dispatchCenters[centerId] = { ...center, name: name.trim() };
  return s;
}

/** Stations that belong to one dispatch center. */
export function stationsInCenter(state: GameState, centerId: string): Station[] {
  return Object.values(state.stations).filter((st) => st.centerId === centerId);
}

/** Units housed at any station in one dispatch center — the center's shared dispatch pool. */
export function unitsInCenter(state: GameState, centerId: string): Unit[] {
  const ids = new Set(stationsInCenter(state, centerId).map((st) => st.id));
  return Object.values(state.units).filter((u) => ids.has(u.stationId));
}

/**
 * The nearest existing dispatch center to `position`, if one is within
 * {@link MUTUAL_AID_SUGGEST_KM} — used to default the "join vs. start a new
 * center" choice when placing a station, without forcing it either way.
 */
export function nearestDispatchCenter(
  state: GameState,
  position: LatLng,
): { centerId: string; distanceKm: number } | null {
  let best: { centerId: string; distanceKm: number } | null = null;
  for (const station of Object.values(state.stations)) {
    const distanceKm = haversineMeters(position, station.position) / 1000;
    if (distanceKm <= MUTUAL_AID_SUGGEST_KM && (!best || distanceKm < best.distanceKm)) {
      best = { centerId: station.centerId, distanceKm };
    }
  }
  return best;
}

// ── stations & fleet ───────────────────────────────────────────────────

export interface NewStation {
  name: string;
  discipline: Discipline;
  address: string;
  position: LatLng;
  staffing: StaffingModel;
  responseRadiusKm: number;
  /** Dispatch center this station joins — create one first with {@link addDispatchCenter} for a new region. */
  centerId: string;
}

export function addStation(
  state: GameState,
  input: NewStation,
  rng: () => number,
): { state: GameState; stationId: string } {
  if (!state.dispatchCenters[input.centerId]) throw new Error(`Unknown dispatch center: ${input.centerId}`);
  const s = draft(state);
  const id = newId(s, 'st');
  // First call comes quickly so a new player sees the loop working.
  const firstCallSec = 45 + rng() * 45;
  s.stations[id] = { id, ...input, nextCallAt: s.clock + firstCallSec * 1000 };
  log(s, 'system', `${input.name} placed in service at ${input.address}.`);
  return { state: s, stationId: id };
}

export function updateStation(
  state: GameState,
  stationId: string,
  patch: Partial<Pick<Station, 'name' | 'address' | 'staffing' | 'responseRadiusKm'>>,
): GameState {
  const station = state.stations[stationId];
  if (!station) return state;
  const s = draft(state);
  s.stations[stationId] = { ...station, ...patch };
  return s;
}

/** Remove a station and its units. Refused while any of its units is committed. */
export function removeStation(state: GameState, stationId: string): GameState {
  const station = state.stations[stationId];
  if (!station) return state;
  const units = Object.values(state.units).filter((u) => u.stationId === stationId);
  if (units.some((u) => u.status !== 'in_quarters')) return state;
  const s = draft(state);
  delete s.stations[stationId];
  for (const u of units) delete s.units[u.id];
  // Drop a center once it has no stations left, so the join/create picker doesn't fill with ghosts.
  if (!Object.values(s.stations).some((st) => st.centerId === station.centerId)) delete s.dispatchCenters[station.centerId];
  log(s, 'system', `${station.name} removed.`);
  return s;
}

export function addUnit(state: GameState, stationId: string, specId: string, callsign: string): GameState {
  const station = state.stations[stationId];
  if (!station) return state;
  getSpec(specId); // validate
  const s = draft(state);
  const id = newId(s, 'u');
  s.units[id] = {
    id,
    callsign,
    specId,
    stationId,
    status: 'in_quarters',
    missionId: null,
    position: station.position,
    trip: null,
    statusSince: s.clock,
  };
  return s;
}

export function renameUnit(state: GameState, unitId: string, callsign: string): GameState {
  const unit = state.units[unitId];
  if (!unit || !callsign.trim()) return state;
  const s = draft(state);
  s.units[unitId] = { ...unit, callsign: callsign.trim() };
  return s;
}

/** Only units in quarters can be taken out of service. */
export function removeUnit(state: GameState, unitId: string): GameState {
  const unit = state.units[unitId];
  if (!unit || unit.status !== 'in_quarters') return state;
  const s = draft(state);
  delete s.units[unitId];
  return s;
}

/** Suggest the next free callsign for a spec at a station, e.g. "Engine 3". */
export function suggestCallsign(state: GameState, specId: string): string {
  const prefix = getSpec(specId).callsignPrefix;
  const taken = new Set(Object.values(state.units).map((u) => u.callsign));
  for (let n = 1; ; n++) if (!taken.has(`${prefix} ${n}`)) return `${prefix} ${n}`;
}

// ── calls ──────────────────────────────────────────────────────────────

export interface CallPlan {
  stationId: string;
  typeId: string;
  position: LatLng;
  narrative: string;
  workRequiredSec: number;
}

function disciplinesFor(station: Station): Discipline[] {
  if (station.discipline === 'police') return ['police'];
  if (station.discipline === 'ems') return ['ems'];
  return ['fire', 'ems']; // fire-based EMS: medical calls appear once an ambulance exists
}

/**
 * Call types this station's area can generate: right discipline, and
 * coverable by its dispatch center's pooled fleet (every station sharing
 * that center) — not by stations in other, unrelated centers.
 */
export function eligibleMissionTypes(state: GameState, station: Station): MissionType[] {
  const fleet = unitsInCenter(state, station.centerId);
  const disciplines = disciplinesFor(station);
  return MISSION_TYPES.filter((t) => disciplines.includes(t.discipline) && matchRequirements(t, fleet).met);
}

export function stationsDueForCall(state: GameState): Station[] {
  return Object.values(state.stations).filter((st) => state.clock >= st.nextCallAt);
}

function pickWeighted<T extends { weight: number }>(items: T[], rng: () => number): T {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = rng() * total;
  for (const item of items) {
    r -= item.weight;
    if (r < 0) return item;
  }
  return items.at(-1)!;
}

/**
 * Decide the next call for a station's area and reschedule its timer.
 * Returns the plan (or null if nothing can be generated right now); the
 * caller may geocode the plan's position before committing it with addMission.
 */
export function planCall(
  state: GameState,
  stationId: string,
  rng: () => number,
): { state: GameState; plan: CallPlan | null } {
  const station = state.stations[stationId];
  if (!station) return { state, plan: null };
  const s = draft(state);
  const interval = CALL_INTERVAL_SEC * (0.5 + rng());
  s.stations[stationId] = { ...station, nextCallAt: s.clock + interval * 1000 };

  const open = Object.values(s.missions).filter((m) => m.stationId === stationId && isOpen(m)).length;
  const types = eligibleMissionTypes(s, station);
  if (open >= MAX_OPEN_CALLS_PER_STATION || types.length === 0) return { state: s, plan: null };

  const type = pickWeighted(types, rng);
  const [minW, maxW] = type.workMinutes;
  const plan: CallPlan = {
    stationId,
    typeId: type.id,
    // Keep calls off the station's own doorstep.
    position: randomPointInRadius(station.position, station.responseRadiusKm * 1000, rng, 300),
    narrative: type.narratives[Math.floor(rng() * type.narratives.length)]!,
    workRequiredSec: Math.round((minW + rng() * (maxW - minW)) * 60),
  };
  return { state: s, plan };
}

export function addMission(
  state: GameState,
  plan: CallPlan,
  address: string,
): { state: GameState; missionId: string } {
  const s = draft(state);
  const id = newId(s, 'm');
  const year = new Date(s.epoch + s.clock).getFullYear() % 100;
  const incidentNumber = `${String(year).padStart(2, '0')}-${String(s.seq).padStart(6, '0')}`;
  const mission: Mission = {
    id,
    incidentNumber,
    typeId: plan.typeId,
    position: plan.position,
    address,
    stationId: plan.stationId,
    narrative: plan.narrative,
    createdAt: s.clock,
    status: 'pending',
    workDoneSec: 0,
    workRequiredSec: plan.workRequiredSec,
    assignedUnitIds: [],
  };
  s.missions[id] = mission;
  log(s, 'call', `New call #${incidentNumber}: ${getMissionType(plan.typeId).name} — ${address}`, id);
  return { state: s, missionId: id };
}

// ── dispatch ───────────────────────────────────────────────────────────

/**
 * Assign an available unit to an open mission. `route` runs from the unit's
 * current position to the incident. Units in quarters spend their station's
 * turnout time before rolling; units already on the road roll immediately.
 */
export function dispatchUnit(state: GameState, unitId: string, missionId: string, route: Route): GameState {
  const unit = state.units[unitId];
  const mission = state.missions[missionId];
  if (!unit || !mission || !isAvailable(unit) || !isOpen(mission) || mission.status === 'resolved') return state;

  const station = state.stations[unit.stationId]!;
  const spec = getSpec(unit.specId);
  const s = draft(state);
  const from = unitPosition(unit, s.clock);
  const turnout = unit.status === 'in_quarters' ? turnoutSeconds(station.staffing, spec.discipline) : 0;
  const trip = makeTrip(
    route,
    from,
    mission.position,
    s.clock + turnout * 1000,
    route.carDurationSec * spec.roadTimeFactor,
  );

  s.units[unitId] = {
    ...unit,
    status: turnout > 0 ? 'dispatched' : 'en_route',
    missionId,
    position: from,
    trip,
    statusSince: s.clock,
  };
  s.missions[missionId] = {
    ...mission,
    status: mission.status === 'pending' ? 'dispatched' : mission.status,
    assignedUnitIds: [...mission.assignedUnitIds, unitId],
  };
  const etaMin = Math.max(1, Math.round((trip.arriveAt - s.clock) / 60_000));
  log(
    s,
    'dispatch',
    `${unit.callsign} dispatched to #${mission.incidentNumber} ${getMissionType(mission.typeId).name} (ETA ${etaMin} min)`,
    missionId,
  );
  return s;
}

/**
 * Take a unit off its mission. A crew still turning out just stands down in
 * quarters; a unit on the road or on scene drives home along `route`
 * (from its current position to its station).
 */
export function releaseUnit(state: GameState, unitId: string, route: Route | null): GameState {
  const unit = state.units[unitId];
  if (!unit || !unit.missionId) return state;
  const s = draft(state);
  const mission = s.missions[unit.missionId];
  if (mission) {
    s.missions[mission.id] = {
      ...mission,
      assignedUnitIds: mission.assignedUnitIds.filter((id) => id !== unitId),
    };
  }
  sendHome(s, unit, route);
  return s;
}

function sendHome(s: GameState, unit: Unit, route: Route | null) {
  const station = s.stations[unit.stationId]!;
  if (unit.status === 'dispatched') {
    s.units[unit.id] = {
      ...unit,
      status: 'in_quarters',
      missionId: null,
      position: station.position,
      trip: null,
      statusSince: s.clock,
    };
    return;
  }
  const from = unitPosition(unit, s.clock);
  const r = route ?? estimateRoute(from, station.position);
  const spec = getSpec(unit.specId);
  const travelSec = r.carDurationSec * Math.max(1, spec.roadTimeFactor) * RETURN_TIME_FACTOR;
  s.units[unit.id] = {
    ...unit,
    status: 'returning',
    missionId: null,
    position: from,
    trip: makeTrip(r, from, station.position, s.clock, travelSec),
    statusSince: s.clock,
  };
}

/**
 * Close a call. 'completed' requires the work to be finished (status
 * 'resolved') and pays out; 'cancelled' can happen any time and doesn't.
 * Every assigned unit is sent home; `routes` maps unitId → route home.
 */
export function closeMission(
  state: GameState,
  missionId: string,
  outcome: 'completed' | 'cancelled',
  routes: Record<string, Route> = {},
): GameState {
  const mission = state.missions[missionId];
  if (!mission || !isOpen(mission)) return state;
  if (outcome === 'completed' && mission.status !== 'resolved') return state;

  const s = draft(state);
  for (const unitId of mission.assignedUnitIds) {
    const unit = s.units[unitId];
    if (unit && unit.missionId === missionId) sendHome(s, unit, routes[unitId] ?? null);
  }
  const type = getMissionType(mission.typeId);
  if (outcome === 'completed') {
    s.credits += type.credits;
    s.stats.completed += 1;
    log(s, 'clear', `#${mission.incidentNumber} ${type.name} cleared. +${type.credits} credits`, missionId);
  } else {
    s.stats.cancelled += 1;
    log(s, 'clear', `#${mission.incidentNumber} ${type.name} cancelled.`, missionId);
  }
  // Closed calls leave the board; their history lives in the log and stats.
  delete s.missions[missionId];
  return s;
}

// ── time ───────────────────────────────────────────────────────────────

/** Advance the simulation by `dtMs` of sim time. */
export function tick(state: GameState, dtMs: number): GameState {
  if (dtMs <= 0) return state;
  const s = draft(state);
  s.clock += dtMs;
  const t = s.clock;

  for (const unit of Object.values(s.units)) {
    let u = unit;
    if (u.status === 'dispatched' && u.trip && t >= u.trip.departAt) {
      u = { ...u, status: 'en_route', statusSince: u.trip.departAt };
    }
    if (u.status === 'en_route' && u.trip && t >= u.trip.arriveAt) {
      const mission = u.missionId ? s.missions[u.missionId] : undefined;
      u = { ...u, status: 'on_scene', position: u.trip.path.at(-1)!, trip: null, statusSince: u.trip.arriveAt };
      if (mission) log(s, 'status', `${u.callsign} on scene at #${mission.incidentNumber}`, mission.id, u.statusSince);
    }
    if (u.status === 'returning' && u.trip && t >= u.trip.arriveAt) {
      u = {
        ...u,
        status: 'in_quarters',
        position: s.stations[u.stationId]?.position ?? u.trip.path.at(-1)!,
        trip: null,
        statusSince: u.trip.arriveAt,
      };
      log(s, 'status', `${u.callsign} in quarters`, undefined, u.statusSince);
    }
    if (u !== unit) s.units[u.id] = u;
  }

  for (const mission of Object.values(s.missions)) {
    if (!isOpen(mission) || mission.status === 'resolved') continue;
    const onScene = missionUnits(s, mission).filter((u) => u.status === 'on_scene');
    const result = matchRequirements(getMissionType(mission.typeId), onScene);
    let next: Mission;
    if (result.met) {
      const workDoneSec = Math.min(mission.workRequiredSec, mission.workDoneSec + dtMs / 1000);
      const done = workDoneSec >= mission.workRequiredSec;
      next = { ...mission, workDoneSec, status: done ? 'resolved' : 'working', resolvedAt: done ? t : undefined };
      if (done) log(s, 'status', `#${mission.incidentNumber} under control — ready to clear`, mission.id);
      else if (mission.status !== 'working')
        log(s, 'status', `#${mission.incidentNumber} all required resources on scene`, mission.id);
    } else {
      next = { ...mission, status: mission.assignedUnitIds.length > 0 ? 'dispatched' : 'pending' };
    }
    if (next.status !== mission.status || next.workDoneSec !== mission.workDoneSec) s.missions[mission.id] = next;
  }
  return s;
}
