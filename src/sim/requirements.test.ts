import { describe, expect, it } from 'vitest';
import { getMissionType } from './data/missions';
import { describeShortfall, matchRequirements, rankCandidates, recommendUnits } from './requirements';
import type { Unit } from './types';

const unit = (id: string, specId: string): Unit => ({
  id,
  callsign: id,
  specId,
  stationId: 's',
  status: 'on_scene',
  missionId: null,
  position: { lat: 0, lng: 0 },
  trip: null,
  statusSince: 0,
});

describe('matchRequirements', () => {
  it('lets a quint fill an engine slot but not two slots at once', () => {
    const chimney = getMissionType('chimney-fire'); // 1 engine + 1 ladder
    expect(matchRequirements(chimney, [unit('q', 'quint-75')]).met).toBe(false);
    expect(matchRequirements(chimney, [unit('q', 'quint-75'), unit('q2', 'quint-75')]).met).toBe(true);
    expect(matchRequirements(chimney, [unit('q', 'quint-75'), unit('e', 'engine-t2')]).met).toBe(true);
  });

  it('finds the assignment a greedy pass would miss', () => {
    // A quint listed first would be parked in an engine slot by a greedy
    // pass, leaving the ladder slot empty once three plain engines arrive.
    // Matching re-routes it to the ladder slot.
    const commercial = getMissionType('structure-fire-commercial');
    const units = [
      unit('q', 'quint-75'),
      unit('e1', 'engine-t1'),
      unit('e2', 'engine-t1'),
      unit('e3', 'engine-t1'),
      unit('t1', 'tender-support-t1'),
      unit('t2', 'tender-support-t2'),
      unit('c', 'command-suv'),
    ];
    const r = matchRequirements(commercial, units);
    expect(r.slots.every((s) => s.unitId)).toBe(true);
    expect(r.slots.find((s) => s.label === 'Ladder')!.unitId).toBe('q');
  });

  it('checks on-scene water and personnel', () => {
    const house = getMissionType('structure-fire-residential'); // 2 engines, 1 tanker, 2500 gal, 8 people
    const r = matchRequirements(house, [unit('e1', 'engine-t2'), unit('e2', 'engine-t2'), unit('t', 'tender-tactical-t2')]);
    expect(r.slots.every((s) => s.unitId)).toBe(true);
    expect(r.water).toEqual({ have: 2000, need: 2500 });
    expect(r.met).toBe(false);
    expect(describeShortfall(r)).toEqual(['500 gal water']);
  });
});

describe('recommendUnits', () => {
  it('takes the closest units that fill the requirement', () => {
    const house = getMissionType('structure-fire-residential');
    const candidatesByDistance = [
      unit('brush', 'engine-t6'),
      unit('e1', 'engine-t1'),
      unit('t1', 'tender-support-t2'),
      unit('e2', 'engine-t1'),
      unit('e3', 'engine-t1'),
      unit('t2', 'tender-support-t2'),
    ];
    const picked = recommendUnits(house, [], candidatesByDistance)!.map((u) => u.id);
    // 2 engines + 1 tanker = 750+750+2500 gal, 4+4+1 = 9 people → met.
    expect(picked).toEqual(['e1', 't1', 'e2']);
  });

  it('tops up water when slots are filled but water is short', () => {
    const house = getMissionType('structure-fire-residential');
    const picked = recommendUnits(house, [], [
      unit('e1', 'engine-t2'),
      unit('e2', 'engine-t2'),
      unit('t1', 'tender-tactical-t2'),
      unit('e3', 'engine-t2'),
    ])!.map((u) => u.id);
    expect(picked).toEqual(['e1', 'e2', 't1', 'e3']);
  });

  it('returns null when the pool cannot cover it', () => {
    expect(recommendUnits(getMissionType('chimney-fire'), [], [unit('e', 'engine-t1')])).toBeNull();
  });
});

describe('rankCandidates', () => {
  it('prefers the better-suited unit when arrival times are close', () => {
    const grass = getMissionType('grass-fire'); // brush or engine
    const ranked = rankCandidates(grass, [
      { unit: unit('engine', 'engine-t1'), etaSec: 600 },
      { unit: unit('brush', 'engine-t6'), etaSec: 630 },
      { unit: unit('far-brush', 'engine-t6'), etaSec: 1200 },
    ]).map((c) => c.unit.id);
    expect(ranked).toEqual(['brush', 'engine', 'far-brush']);
    expect(recommendUnits(grass, [], ranked.map((id) => unit(id, id.includes('brush') ? 'engine-t6' : 'engine-t1')))!.map((u) => u.id)).toEqual(['brush']);
  });
});
