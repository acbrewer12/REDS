// Core data model for the simulation. Everything here is plain JSON so the
// whole game state can be persisted, sent to a server later, or replayed.

export interface LatLng {
  lat: number;
  lng: number;
}

export type Discipline = 'fire' | 'police' | 'ems';

/**
 * Functional role a vehicle can fill on an incident. An apparatus has one
 * primary role (used for its map icon) and may be able to fill others — a
 * quint is a ladder that can also work as an engine, for example.
 */
export type UnitRole =
  | 'engine' // structural pumper
  | 'ladder' // aerial device
  | 'tanker' // mobile water supply / water tender
  | 'brush' // wildland engine (NWCG Type 3–7)
  | 'rescue' // heavy / technical rescue
  | 'command' // chief officer / command vehicle
  | 'patrol' // law-enforcement patrol unit
  | 'ambulance';

/** A real-world apparatus model with spec-sheet numbers, not game stats. */
export interface ApparatusSpec {
  id: string;
  name: string;
  discipline: Discipline;
  role: UnitRole;
  /** Roles this vehicle can fill on scene. Always includes `role`. */
  roles: UnitRole[];
  /** NWCG / NIMS resource type, e.g. "Engine Type 1", "Water Tender (Support) Type 2". */
  nwcgType?: string;
  /** Design standard the spec follows, e.g. "NFPA 1901 pumper". */
  standard?: string;
  /** Rated pump capacity in gallons per minute (0 = no fire pump). */
  pumpGpm: number;
  /** Pressure the pump is rated at, in psi. */
  pumpPsi?: number;
  /** Booster / water tank capacity in US gallons. */
  tankGallons: number;
  foamGallons?: number;
  /** Aerial device working height, feet. */
  aerialFeet?: number;
  /** Typical seated crew. */
  crew: number;
  /** Minimum staffing per NWCG typing (or department SOP where NWCG is silent). */
  minCrew: number;
  /**
   * Multiplier applied to a passenger-car drive time on the same road route.
   * <1 = faster than traffic (patrol car running code 3), >1 = heavy apparatus.
   */
  roadTimeFactor: number;
  /** 4x4 / off-road capable. */
  offRoad: boolean;
  /** Purchase price in game credits (unused until the economy milestone). */
  cost: number;
  /** Default callsign prefix ("Engine", "Tanker", …). */
  callsignPrefix: string;
  description: string;
}

/**
 * Unit status, modelled on common CAD status codes:
 *  in_quarters — available at station
 *  dispatched  — alerted, crew turning out (still at station)
 *  en_route    — responding
 *  on_scene    — working the incident
 *  returning   — available, driving back to quarters (can be re-assigned)
 */
export type UnitStatus = 'in_quarters' | 'dispatched' | 'en_route' | 'on_scene' | 'returning';

/** A movement along a path. Positions are derived from (trip, clock). */
export interface Trip {
  path: LatLng[];
  /** Cumulative distance in meters for each path vertex (cumDist[0] === 0). */
  cumDist: number[];
  /** Sim time (ms) the wheels start rolling. */
  departAt: number;
  /** Sim time (ms) the unit arrives. */
  arriveAt: number;
  /** Whether the path came from a road router or a straight-line estimate. */
  source: 'road' | 'estimate';
}

export interface Unit {
  id: string;
  callsign: string;
  specId: string;
  stationId: string;
  status: UnitStatus;
  missionId: string | null;
  /** Resting position (station or scene). While moving, see `trip`. */
  position: LatLng;
  trip: Trip | null;
  statusSince: number;
}

export type StaffingModel = 'career' | 'combination' | 'volunteer';

export interface Station {
  id: string;
  name: string;
  discipline: Discipline;
  address: string;
  position: LatLng;
  staffing: StaffingModel;
  /** Radius (km) of the station's first-due area, where its calls are generated. */
  responseRadiusKm: number;
  /** Sim time (ms) the next call should be generated in this station's area. */
  nextCallAt: number;
}

/**
 * pending    — call received, nothing assigned
 * dispatched — units assigned but the requirement isn't met on scene yet
 * working    — requirement met on scene, work is progressing
 * resolved   — work finished, waiting for dispatcher to clear the call
 * completed  — cleared (kept only for history/stats)
 * cancelled  — cleared without being worked
 */
export type MissionStatus = 'pending' | 'dispatched' | 'working' | 'resolved' | 'completed' | 'cancelled';

export interface Mission {
  id: string;
  /** Short CAD incident number, e.g. "26-000123". */
  incidentNumber: string;
  typeId: string;
  position: LatLng;
  address: string;
  /** Station whose first-due area generated the call. */
  stationId: string;
  narrative: string;
  createdAt: number;
  status: MissionStatus;
  /** Seconds of on-scene work completed. */
  workDoneSec: number;
  workRequiredSec: number;
  /** Units currently assigned (dispatched, en route or on scene). */
  assignedUnitIds: string[];
  resolvedAt?: number;
  closedAt?: number;
}

export interface UnitRequirement {
  /** Display label, e.g. "Engine". */
  label: string;
  /** Any of these roles satisfies the slot. */
  accepts: UnitRole[];
  count: number;
}

export interface MissionType {
  id: string;
  name: string;
  /** Map / list glyph. */
  icon: string;
  discipline: Discipline;
  units: UnitRequirement[];
  /** Total tank water (gallons) that must be on scene. */
  minWaterGallons?: number;
  /** Total personnel that must be on scene. */
  minPersonnel?: number;
  /** On-scene work time range in minutes. */
  workMinutes: [number, number];
  credits: number;
  /** Relative frequency. */
  weight: number;
  /** Caller / CAD narrative lines; one is picked per call. */
  narratives: string[];
}

export type LogKind = 'call' | 'dispatch' | 'status' | 'clear' | 'system';

export interface LogEntry {
  id: number;
  t: number;
  kind: LogKind;
  text: string;
  missionId?: string;
}

export interface GameState {
  version: 1;
  /** Real-world epoch (ms) that sim time 0 corresponds to, for CAD clock display. */
  epoch: number;
  /** Elapsed sim time in ms. */
  clock: number;
  stations: Record<string, Station>;
  units: Record<string, Unit>;
  missions: Record<string, Mission>;
  log: LogEntry[];
  credits: number;
  stats: { completed: number; cancelled: number };
  /** Monotonic counters for ids / incident numbers. */
  seq: number;
}
