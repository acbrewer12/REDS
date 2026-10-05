import { getSpec } from './data/apparatus';
import type { MissionType, Unit, UnitRole } from './types';

export interface SlotResult {
  label: string;
  accepts: UnitRole[];
  unitId: string | null;
}

export interface RequirementResult {
  met: boolean;
  /** One entry per required vehicle (a "2× Engine" requirement yields two slots). */
  slots: SlotResult[];
  water: { have: number; need: number };
  personnel: { have: number; need: number };
}

/**
 * Match units to a mission type's requirement slots.
 *
 * A unit can fill one slot, and only slots that accept one of its roles.
 * Requirements overlap ("brush or engine" vs "engine"), so a greedy pass can
 * miss valid assignments; this uses augmenting-path bipartite matching
 * (Kuhn's algorithm), which is exact and trivially fast for fleet sizes.
 */
export function matchRequirements(type: MissionType, units: Unit[]): RequirementResult {
  const slots: SlotResult[] = type.units.flatMap((r) =>
    Array.from({ length: r.count }, () => ({ label: r.label, accepts: r.accepts, unitId: null })),
  );
  const roles = units.map((u) => getSpec(u.specId).roles);
  const slotOwner: (number | null)[] = slots.map(() => null);

  const tryAssign = (ui: number, seen: boolean[]): boolean => {
    for (let si = 0; si < slots.length; si++) {
      if (seen[si] || !slots[si]!.accepts.some((r) => roles[ui]!.includes(r))) continue;
      seen[si] = true;
      const owner = slotOwner[si]!;
      if (owner === null || tryAssign(owner, seen)) {
        slotOwner[si] = ui;
        return true;
      }
    }
    return false;
  };
  for (let ui = 0; ui < units.length; ui++) tryAssign(ui, slots.map(() => false));
  slotOwner.forEach((ui, si) => {
    if (ui !== null) slots[si]!.unitId = units[ui]!.id;
  });

  const water = {
    have: units.reduce((sum, u) => sum + getSpec(u.specId).tankGallons, 0),
    need: type.minWaterGallons ?? 0,
  };
  const personnel = {
    have: units.reduce((sum, u) => sum + getSpec(u.specId).crew, 0),
    need: type.minPersonnel ?? 0,
  };
  const met = slots.every((s) => s.unitId !== null) && water.have >= water.need && personnel.have >= personnel.need;
  return { met, slots, water, personnel };
}

/** Human-readable list of what's still missing, e.g. ["1× Tanker", "500 gal water"]. */
export function describeShortfall(result: RequirementResult): string[] {
  const missing = new Map<string, number>();
  for (const s of result.slots) if (!s.unitId) missing.set(s.label, (missing.get(s.label) ?? 0) + 1);
  const out = [...missing].map(([label, n]) => `${n}× ${label}`);
  if (result.water.have < result.water.need) out.push(`${(result.water.need - result.water.have).toLocaleString()} gal water`);
  if (result.personnel.have < result.personnel.need) out.push(`${result.personnel.need - result.personnel.have} personnel`);
  return out;
}

/**
 * How well a unit suits a mission type: 0 when its primary role is the first
 * choice of some requirement (a brush truck on a grass fire), higher for
 * fallbacks (an engine on a grass fire), Infinity when it can't help at all.
 */
export function suitability(type: MissionType, unit: Unit): number {
  const spec = getSpec(unit.specId);
  let best = Infinity;
  for (const r of type.units) {
    const primary = r.accepts.indexOf(spec.role);
    if (primary >= 0) best = Math.min(best, primary);
    else if (r.accepts.some((role) => spec.roles.includes(role))) best = Math.min(best, r.accepts.length);
  }
  return best;
}

/**
 * Order dispatch candidates: closest first, with units arriving within the
 * same minute ordered by suitability.
 */
export function rankCandidates<T extends { unit: Unit; etaSec: number }>(type: MissionType, candidates: T[]): T[] {
  return [...candidates].sort(
    (a, b) =>
      Math.floor(a.etaSec / 60) - Math.floor(b.etaSec / 60) ||
      suitability(type, a.unit) - suitability(type, b.unit) ||
      a.etaSec - b.etaSec,
  );
}

/**
 * Pick units for a mission: walk candidates in order (closest first) and take
 * each one that fills an unfilled slot, then keep adding the next-closest
 * water / crew carriers until the totals are met. Returns null if the
 * candidate pool can't meet the requirement. This is the building block for
 * the future auto-dispatch AI; today it powers "Select recommended".
 */
export function recommendUnits(type: MissionType, alreadyAssigned: Unit[], candidates: Unit[]): Unit[] | null {
  const chosen: Unit[] = [];
  let result = matchRequirements(type, alreadyAssigned);
  if (result.met) return [];

  const filledSlots = (r: RequirementResult) => r.slots.filter((s) => s.unitId).length;
  for (const unit of candidates) {
    const trial = matchRequirements(type, [...alreadyAssigned, ...chosen, unit]);
    if (filledSlots(trial) > filledSlots(result)) {
      chosen.push(unit);
      result = trial;
    }
    if (result.met) return chosen;
  }

  // Slots filled but water / personnel short: add the nearest units that help.
  for (const unit of candidates) {
    if (chosen.includes(unit)) continue;
    const spec = getSpec(unit.specId);
    const helpsWater = result.water.have < result.water.need && spec.tankGallons > 0;
    const helpsCrew = result.personnel.have < result.personnel.need && spec.crew > 0;
    if (!helpsWater && !helpsCrew) continue;
    if (!type.units.some((r) => r.accepts.some((role) => spec.roles.includes(role)))) continue;
    chosen.push(unit);
    result = matchRequirements(type, [...alreadyAssigned, ...chosen]);
    if (result.met) return chosen;
  }
  return null;
}
