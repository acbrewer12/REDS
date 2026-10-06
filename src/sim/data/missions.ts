import type { MissionType } from '../types';

// Call types. Requirements are expressed as roles + on-scene water and
// staffing, so a rural department with no hydrants needs tankers on a
// structure fire, and a quint can stand in for an engine.

export const MISSION_TYPES: MissionType[] = [
  // ── Fire ──────────────────────────────────────────────────────────────
  {
    id: 'fire-alarm',
    name: 'Fire alarm activation',
    icon: '🔔',
    discipline: 'fire',
    units: [{ label: 'Engine', accepts: ['engine'], count: 1 }],
    workMinutes: [5, 12],
    credits: 150,
    weight: 10,
    narratives: [
      'Alarm company reports general fire alarm, zone 3 smoke detector. Keyholder en route.',
      'Monitoring company reports a residential smoke detector activation, no answer on callback.',
      'Commercial alarm, pull station activation at main entrance.',
    ],
  },
  {
    id: 'grass-fire',
    name: 'Grass / field fire',
    icon: '🌾',
    discipline: 'fire',
    units: [{ label: 'Brush truck or engine', accepts: ['brush', 'engine'], count: 1 }],
    minWaterGallons: 300,
    workMinutes: [12, 30],
    credits: 300,
    weight: 10,
    narratives: [
      'Caller reports a field on fire along the fence line, spreading toward a hay barn.',
      'Debris burn got away from the landowner, approx. one acre involved.',
      'Passerby reports grass fire in the ditch, possible cigarette.',
    ],
  },
  {
    id: 'woodland-fire',
    name: 'Woodland fire',
    icon: '🌲',
    discipline: 'fire',
    units: [
      { label: 'Brush truck', accepts: ['brush'], count: 2 },
      { label: 'Tanker', accepts: ['tanker'], count: 1 },
    ],
    minWaterGallons: 1500,
    minPersonnel: 5,
    workMinutes: [35, 70],
    credits: 900,
    weight: 4,
    narratives: [
      'Smoke column visible from the highway; fire in the timber, moving uphill with the wind.',
      'Landowner reports fire in the woods behind the house, getting close to outbuildings.',
    ],
  },
  {
    id: 'vehicle-fire',
    name: 'Vehicle fire',
    icon: '🚗',
    discipline: 'fire',
    units: [{ label: 'Engine', accepts: ['engine'], count: 1 }],
    minWaterGallons: 500,
    workMinutes: [10, 20],
    credits: 250,
    weight: 6,
    narratives: [
      'Pickup on fire on the shoulder, driver is out of the vehicle.',
      'Car fire in a driveway, flames from under the hood.',
    ],
  },
  {
    id: 'chimney-fire',
    name: 'Chimney fire',
    icon: '🧱',
    discipline: 'fire',
    units: [
      { label: 'Engine', accepts: ['engine'], count: 1 },
      { label: 'Ladder', accepts: ['ladder'], count: 1 },
    ],
    workMinutes: [20, 40],
    credits: 450,
    weight: 4,
    narratives: [
      'Homeowner reports loud roaring from the wood stove flue, sparks out the top of the chimney.',
      'Neighbor reports flames from the chimney of a two-story house.',
    ],
  },
  {
    id: 'structure-fire-residential',
    name: 'Residential structure fire',
    icon: '🏠',
    discipline: 'fire',
    units: [
      { label: 'Engine', accepts: ['engine'], count: 2 },
      { label: 'Tanker', accepts: ['tanker'], count: 1 },
    ],
    minWaterGallons: 2500,
    minPersonnel: 8,
    workMinutes: [40, 90],
    credits: 1500,
    weight: 3,
    narratives: [
      'Caller reports smoke and flames from a single-story house, all occupants believed out.',
      'Kitchen fire extended to the attic, heavy smoke showing. No hydrants in the area.',
      'Mobile home fully involved, exposure threat to the residence next door.',
    ],
  },
  {
    id: 'structure-fire-commercial',
    name: 'Commercial structure fire',
    icon: '🏢',
    discipline: 'fire',
    units: [
      { label: 'Engine', accepts: ['engine'], count: 3 },
      { label: 'Ladder', accepts: ['ladder'], count: 1 },
      { label: 'Tanker', accepts: ['tanker'], count: 2 },
      { label: 'Command', accepts: ['command'], count: 1 },
    ],
    minWaterGallons: 6000,
    minPersonnel: 14,
    workMinutes: [60, 120],
    credits: 3500,
    weight: 1,
    narratives: [
      'Employees report fire in the back storage area of a retail store, building evacuated.',
      'Smoke showing from the roof of a metal-clad shop building.',
    ],
  },
  {
    id: 'mva-injury',
    name: 'Motor vehicle crash with injuries',
    icon: '💥',
    discipline: 'fire',
    units: [{ label: 'Engine', accepts: ['engine', 'rescue'], count: 1 }],
    workMinutes: [15, 30],
    credits: 350,
    weight: 6,
    narratives: [
      'Two-vehicle crash at the intersection, one patient complaining of neck pain, fluids leaking.',
      'Single vehicle in the ditch, driver conscious but bleeding from the head.',
    ],
  },
  {
    id: 'mva-entrapment',
    name: 'Motor vehicle crash with entrapment',
    icon: '🚑',
    discipline: 'fire',
    units: [
      { label: 'Engine', accepts: ['engine'], count: 1 },
      { label: 'Rescue', accepts: ['rescue'], count: 1 },
    ],
    minPersonnel: 6,
    workMinutes: [30, 50],
    credits: 900,
    weight: 2,
    narratives: [
      'Head-on collision, driver of one vehicle pinned by the dash.',
      'Vehicle rolled over into the creek bed, occupant trapped.',
    ],
  },
  {
    id: 'gas-odor',
    name: 'Natural gas / propane odor',
    icon: '⚠️',
    discipline: 'fire',
    units: [{ label: 'Engine', accepts: ['engine'], count: 1 }],
    workMinutes: [10, 25],
    credits: 200,
    weight: 5,
    narratives: [
      'Resident smells propane near the tank outside the house.',
      'Strong gas odor inside a business, staff have evacuated.',
    ],
  },
  {
    id: 'lines-down',
    name: 'Power lines down',
    icon: '⚡',
    discipline: 'fire',
    units: [{ label: 'Any fire apparatus', accepts: ['engine', 'brush', 'rescue', 'command'], count: 1 }],
    workMinutes: [15, 45],
    credits: 200,
    weight: 4,
    narratives: [
      'Tree on the lines, wires arcing on the road. Utility notified.',
      'Line down across the driveway after the storm, caller cannot get out.',
    ],
  },
  {
    id: 'medical-assist',
    name: 'Medical assist / lift assist',
    icon: '🩹',
    discipline: 'fire',
    units: [{ label: 'First responder', accepts: ['engine', 'brush', 'rescue', 'command'], count: 1 }],
    workMinutes: [10, 20],
    credits: 150,
    weight: 6,
    narratives: [
      'Elderly male fell, uninjured, unable to get up. Requesting lift assist.',
      'Ambulance requesting manpower to carry a patient down stairs.',
    ],
  },

  // ── Law enforcement ───────────────────────────────────────────────────
  {
    id: 'suspicious-vehicle',
    name: 'Suspicious vehicle',
    icon: '🔎',
    discipline: 'police',
    units: [{ label: 'Patrol', accepts: ['patrol'], count: 1 }],
    workMinutes: [8, 20],
    credits: 120,
    weight: 8,
    // Lights/siren would just tip the subject off before the unit arrives.
    emergencyResponse: false,
    narratives: [
      'Vehicle parked behind the closed business with lights off, occupied.',
      'Unknown truck has been sitting at the end of the caller’s gravel road for an hour.',
    ],
  },
  {
    id: 'alarm-burglary',
    name: 'Burglary alarm',
    icon: '🚨',
    discipline: 'police',
    units: [{ label: 'Patrol', accepts: ['patrol'], count: 1 }],
    workMinutes: [8, 15],
    credits: 120,
    weight: 8,
    // Unverified alarm — the overwhelming majority are false; standard
    // procedure is a routine (non-emergency) response unless something
    // upgrades it (open door, witness, duress signal).
    emergencyResponse: false,
    narratives: ['Alarm company reports rear door contact, no keyholder.', 'Motion alarm at the pharmacy, after hours.'],
  },
  {
    id: 'disturbance',
    name: 'Disturbance / domestic',
    icon: '📣',
    discipline: 'police',
    units: [{ label: 'Patrol', accepts: ['patrol'], count: 2 }],
    workMinutes: [20, 45],
    credits: 350,
    weight: 6,
    narratives: [
      'Neighbor reports yelling and something breaking next door.',
      'Caller states her ex-boyfriend is refusing to leave the residence.',
    ],
  },
  {
    id: 'theft',
    name: 'Shoplifting in custody',
    icon: '🛒',
    discipline: 'police',
    units: [{ label: 'Patrol', accepts: ['patrol'], count: 1 }],
    workMinutes: [20, 40],
    credits: 200,
    weight: 5,
    emergencyResponse: false, // subject is already detained — no urgency
    narratives: ['Store loss prevention has a shoplifter detained in the office.'],
  },
  {
    id: 'welfare-check',
    name: 'Welfare check',
    icon: '🏚️',
    discipline: 'police',
    units: [{ label: 'Patrol', accepts: ['patrol'], count: 1 }],
    workMinutes: [10, 25],
    credits: 120,
    weight: 6,
    emergencyResponse: false, // routine unless the caller reports something more specific
    narratives: [
      'Family out of state has not heard from their elderly father in three days.',
      'Mail piling up at the residence, newspaper on the porch since last week.',
    ],
  },
  {
    id: 'livestock-roadway',
    name: 'Livestock in the roadway',
    icon: '🐄',
    discipline: 'police',
    units: [{ label: 'Patrol', accepts: ['patrol'], count: 1 }],
    workMinutes: [15, 40],
    credits: 150,
    weight: 4,
    emergencyResponse: false, // a hazard, but routine driving gets there plenty fast
    narratives: [
      'Six head of cattle out on the highway, fence down. Owner unknown.',
      'Horse loose on the county road near the low-water crossing.',
    ],
  },
  {
    id: 'crash-pdo',
    name: 'Traffic crash, property damage',
    icon: '🚙',
    discipline: 'police',
    units: [{ label: 'Patrol', accepts: ['patrol'], count: 1 }],
    workMinutes: [15, 30],
    credits: 180,
    weight: 6,
    emergencyResponse: false, // no injuries reported
    narratives: ['Minor fender-bender in the grocery store lot, no injuries, parties need a report.'],
  },

  // ── EMS (only generated once an ambulance is in the fleet) ────────────
  {
    id: 'ems-chest-pain',
    name: 'Medical — chest pain',
    icon: '❤️',
    discipline: 'ems',
    units: [{ label: 'Ambulance', accepts: ['ambulance'], count: 1 }],
    workMinutes: [20, 40],
    credits: 400,
    weight: 6,
    narratives: ['62-year-old male, chest pain radiating to left arm, diaphoretic.'],
  },
  {
    id: 'ems-fall',
    name: 'Medical — fall injury',
    icon: '🩼',
    discipline: 'ems',
    units: [{ label: 'Ambulance', accepts: ['ambulance'], count: 1 }],
    workMinutes: [15, 35],
    credits: 300,
    weight: 5,
    narratives: ['Female fell from a ladder approx. 8 ft, possible broken wrist, conscious and alert.'],
  },
];

export const MISSION_TYPES_BY_ID: Record<string, MissionType> = Object.fromEntries(
  MISSION_TYPES.map((m) => [m.id, m]),
);

export function getMissionType(id: string): MissionType {
  const t = MISSION_TYPES_BY_ID[id];
  if (!t) throw new Error(`Unknown mission type: ${id}`);
  return t;
}
