import { describe, expect, it } from 'vitest';
import { cumulativeDistances, haversineMeters, pointAlongPath, randomPointInRadius, tripPosition } from './geo';
import { mulberry32 } from './rng';

const SALEM = { lat: 37.6456, lng: -91.5357 };
const ROLLA = { lat: 37.9514, lng: -91.7713 };

describe('geo', () => {
  it('computes great-circle distance', () => {
    // Salem → Rolla is ~39.5 km as the crow flies.
    expect(haversineMeters(SALEM, ROLLA) / 1000).toBeCloseTo(39.5, 0);
    expect(haversineMeters(SALEM, SALEM)).toBe(0);
  });

  it('interpolates along a multi-segment path', () => {
    const path = [SALEM, { lat: 37.6456, lng: -91.5 }, { lat: 37.68, lng: -91.5 }];
    const cum = cumulativeDistances(path);
    expect(pointAlongPath(path, cum, 0)).toEqual(SALEM);
    expect(pointAlongPath(path, cum, 1e9)).toEqual(path[2]);
    const mid = pointAlongPath(path, cum, cum[1]! / 2);
    expect(mid.lat).toBeCloseTo(37.6456, 6);
    expect(mid.lng).toBeCloseTo((-91.5357 + -91.5) / 2, 6);
  });

  it('moves at constant speed over a trip', () => {
    const path = [SALEM, ROLLA];
    const trip = { path, cumDist: cumulativeDistances(path), departAt: 1000, arriveAt: 3000, source: 'estimate' as const };
    expect(tripPosition(trip, 0)).toEqual(SALEM);
    expect(tripPosition(trip, 5000)).toEqual(ROLLA);
    // Linear lat/lng interpolation: within 0.1% of the true midpoint on a 40 km segment.
    const half = tripPosition(trip, 2000);
    const diff = Math.abs(haversineMeters(SALEM, half) - haversineMeters(half, ROLLA));
    expect(diff / haversineMeters(SALEM, ROLLA)).toBeLessThan(0.001);
  });

  it('generates random points inside the radius ring', () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 500; i++) {
      const d = haversineMeters(SALEM, randomPointInRadius(SALEM, 8000, rng, 300));
      expect(d).toBeGreaterThanOrEqual(299);
      expect(d).toBeLessThanOrEqual(8001);
    }
  });
});
