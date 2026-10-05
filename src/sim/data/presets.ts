import type { Discipline, StaffingModel } from '../types';

// Fleet presets offered when placing a station.
//
// The Dent County FPD roster below uses the unit designations gathered for
// Salem, MO (Engine 8010/8020/8030, Ladder 8012, plus tankers and brush
// trucks). Spec choices for those rigs, and the tanker/brush unit numbers,
// are placeholders until the real fleet sheet is pasted in — rename units
// in-game or edit this file. All units are housed in one station for the
// single-station prototype; the district actually spreads them across
// several houses, which the multi-station milestone will model.

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
      { specId: 'engine-t1', callsign: 'Engine 8010' },
      { specId: 'quint-75', callsign: 'Ladder 8012' },
      { specId: 'engine-t2', callsign: 'Engine 8020' },
      { specId: 'engine-t2', callsign: 'Engine 8030' },
      { specId: 'tender-support-t2', callsign: 'Tanker 1' },
      { specId: 'tender-support-t2', callsign: 'Tanker 2' },
      { specId: 'engine-t6', callsign: 'Brush 1' },
      { specId: 'engine-t6', callsign: 'Brush 2' },
    ],
    note: 'Engine/ladder designations are the district’s; specs and tanker/brush numbers are placeholders — verify.',
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
    id: 'small-town-pd',
    name: 'Small-town police department',
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
    note: 'Generic roster — replace with the Salem PD fleet once pasted in.',
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
