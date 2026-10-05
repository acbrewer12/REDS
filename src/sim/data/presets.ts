import type { Discipline, StaffingModel } from '../types';

// Fleet presets offered when placing a station.
//
// Dent County FPD (Salem, MO) — REAL, SOURCED DATA.
//   Station: 2 South Main Street, Salem, MO 65560. Phone 573-729-3250.
//   Fire Chief: Dennis Floyd. Source: United Way 211 directory.
//   Apparatus roster sourced from the district's own Facebook post and a
//   community fire-apparatus wiki roster (see per-unit specs in
//   data/apparatus.ts, ids prefixed `dcfpd-`). Two items remain uncertain
//   and are flagged inline where used below and in apparatus.ts:
//     - Engine 8030 (1996 Freightliner) may already be retired/transferred
//       under the district's "Proposition Fire" bond-funded apparatus
//       replacement program — kept in the roster as provisional.
//     - Two 2025 Ford F-350 brush trucks are ON ORDER, not yet in service,
///      so they are left out of the default fleet (see
//       `dcfpd-brush-pending-350` in apparatus.ts).
//   The district funded this fleet upgrade via a $3.5M "Proposition Fire"
//   bond (registered 07/11/2025) and has been handing down older retired
//   apparatus to mutual-aid partners (Montauk Rural Fire Department,
//   Jadwin VFD) rather than scrapping it.
//
// Salem Police Department — REAL, SOURCED DATA.
//   Station: 500 North Jackson St, Salem, MO 65560. Chief: Joe Chase.
//   12 sworn officers, ~3 civilian staff (15 total) per Missouri UCR/NIBRS
//   (ORI MO0330100), serving a population of 4,736 (Dent County). This is a
//   tiny rural department — the roster below starts with the one patrol car
//   it actually runs today; growing it to 2-6 patrol units in-game is
//   realistic, anything bigger (SWAT, K9, etc.) is not.
//
// All units are housed in one station for the single-station prototype;
// the district actually spreads them across several houses, which the
// multi-station milestone will model.

export interface FleetPresetUnit {
  specId: string;
  callsign: string;
}

export interface FleetPreset {
  id: string;
  name: string;
  discipline: Discipline;
  staffing: StaffingModel;
  /** Suggested station name. */
  stationName: string;
  responseRadiusKm: number;
  units: FleetPresetUnit[];
  note?: string;
}

export const FLEET_PRESETS: FleetPreset[] = [
  {
    id: 'dent-county-fpd',
    name: 'Dent County FPD (Salem, MO)',
    discipline: 'fire',
    staffing: 'volunteer',
    stationName: 'Dent County FPD Station 1',
    responseRadiusKm: 12,
    units: [
      { specId: 'dcfpd-engine-8010', callsign: 'Engine 8010' },
      { specId: 'dcfpd-ladder-8012', callsign: 'Ladder 8012' },
      { specId: 'dcfpd-engine-8020', callsign: 'Engine 8020' },
      { specId: 'dcfpd-engine-8030', callsign: 'Engine 8030' },
      { specId: 'dcfpd-pumper-tanker-8013', callsign: 'Pumper Tanker 8013' },
      { specId: 'dcfpd-pumper-tanker-8023', callsign: 'Pumper Tanker 8023' },
      { specId: 'dcfpd-rescue-8016', callsign: 'Rescue 8016' },
      { specId: 'dcfpd-brush-8018', callsign: 'Brush 8018' },
      { specId: 'dcfpd-brush-8028', callsign: 'Brush 8028' },
      { specId: 'dcfpd-brush-8038', callsign: 'Brush 8038' },
      { specId: 'dcfpd-truck-8026', callsign: 'Truck 8026' },
    ],
    note:
      'Real district roster (station: 2 S Main St, Salem, MO). Engine 8030 may already be retired/transferred — see apparatus.ts. ' +
      'Two F-350 brush trucks are on order and not included yet.',
  },
  {
    id: 'rural-fire-basic',
    name: 'Rural fire station (engine, tanker, brush)',
    discipline: 'fire',
    staffing: 'volunteer',
    stationName: 'Fire Station 1',
    responseRadiusKm: 10,
    units: [
      { specId: 'engine-t2', callsign: 'Engine 1' },
      { specId: 'engine-t2', callsign: 'Engine 2' },
      { specId: 'tender-support-t2', callsign: 'Tanker 1' },
      { specId: 'engine-t6', callsign: 'Brush 1' },
    ],
  },
  {
    id: 'career-fire',
    name: 'Career fire station (engine, ladder, rescue)',
    discipline: 'fire',
    staffing: 'career',
    stationName: 'Fire Station 1',
    responseRadiusKm: 5,
    units: [
      { specId: 'engine-t1', callsign: 'Engine 1' },
      { specId: 'engine-t1', callsign: 'Engine 2' },
      { specId: 'ladder-100', callsign: 'Truck 1' },
      { specId: 'rescue-heavy', callsign: 'Rescue 1' },
      { specId: 'tender-tactical-t1', callsign: 'Tanker 1' },
      { specId: 'command-suv', callsign: 'Battalion 1' },
    ],
  },
  {
    id: 'salem-pd',
    name: 'Salem Police Department (Salem, MO)',
    discipline: 'police',
    staffing: 'career',
    stationName: 'Salem Police Department',
    responseRadiusKm: 6,
    units: [{ specId: 'patrol-suv', callsign: 'Unit 1' }],
    note:
      'Real department: 500 N Jackson St, Salem, MO. Chief Joe Chase, 12 sworn officers (Missouri UCR/NIBRS ORI MO0330100), ' +
      'pop. served 4,736. Starts with the one patrol car Salem PD actually runs — add up to 2-6 units in-game as it grows; ' +
      'this tiny department would not run SWAT, K9, or federal-scale units.',
  },
  {
    id: 'small-town-pd',
    name: 'Small-town police department (generic)',
    discipline: 'police',
    staffing: 'career',
    stationName: 'Police Department',
    responseRadiusKm: 5,
    units: [
      { specId: 'patrol-suv', callsign: 'Unit 1' },
      { specId: 'patrol-suv', callsign: 'Unit 2' },
      { specId: 'patrol-suv', callsign: 'Unit 3' },
      { specId: 'patrol-pickup', callsign: 'Unit 4' },
    ],
    note: 'Generic placeholder roster for a town not otherwise modeled — use Salem Police Department for the real Salem, MO fleet.',
  },
  {
    id: 'empty',
    name: 'Empty station (add units yourself)',
    discipline: 'fire',
    staffing: 'combination',
    stationName: 'Station 1',
    responseRadiusKm: 8,
    units: [],
  },
];

export const FLEET_PRESETS_BY_ID: Record<string, FleetPreset> = Object.fromEntries(
  FLEET_PRESETS.map((p) => [p.id, p]),
);

/**
 * Crew turnout time (alert → wheels rolling), seconds. Career figure is the
 * NFPA 1710 fire turnout benchmark; volunteer crews respond from home first.
 */
export const TURNOUT_SECONDS: Record<StaffingModel, number> = {
  career: 80,
  combination: 150,
  volunteer: 300,
};

/** Police units are staffed and in service — they only need to get to the car. */
export const POLICE_TURNOUT_SECONDS = 30;
