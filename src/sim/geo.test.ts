import { describe, expect, it } from 'vitest';
import {
  buildCumTime,
  cumulativeDistances,
  haversineMeters,
  pointAlongPath,
  randomPointInRadius,
  tripCurrentSegment,
  tripPosition,
} from './geo';
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
    const cumDist = cumulativeDistances(path);
    const trip = {
      path,
      cumDist,
      cumTime: buildCumTime(cumDist, undefined, 2000),
      departAt: 1000,
      arriveAt: 3000,
      source: 'estimate' as const,
    };
    expect(tripPosition(trip, 0)).toEqual(SALEM);
    expect(tripPosition(trip, 5000)).toEqual(ROLLA);
    // Linear lat/lng interpolation: within 0.1% of the true midpoint on a 40 km segment.
    const half = tripPosition(trip, 2000);
    const diff = Math.abs(haversineMeters(SALEM, half) - haversineMeters(half, ROLLA));
    expect(diff / haversineMeters(SALEM, ROLLA)).toBeLessThan(0.001);
  });

  it('varies speed segment to segment instead of one flat trip-average', () => {
    // Two equal-length (~5.56 km) segments, but segment 1 is timed to take
    // 4x as long as segment 2 — a slow residential stretch into town, then
    // a fast one on the open road, the way real per-segment road data would.
    const mid = { lat: SALEM.lat, lng: SALEM.lng + (ROLLA.lng - SALEM.lng) / 2 };
    const path = [SALEM, mid, ROLLA];
    const cumDist = cumulativeDistances(path);
    const totalMs = 10_000;
    const cumTime = buildCumTime(cumDist, [800, 200], totalMs); // seconds, arbitrary unit — just a ratio
    const trip = { path, cumDist, cumTime, departAt: 0, arriveAt: totalMs, source: 'road' as const };

    const [, slowDurationSec] = tripCurrentSegment(trip, 2000); // still in segment 1 (0–8000ms)
    const [, fastDurationSec] = tripCurrentSegment(trip, 9000); // into segment 2 (8000–10000ms)
    // Same distance, 4x the time on segment 1 → segment 2 reads ~4x faster.
    expect(fastDurationSec).toBeLessThan(slowDurationSec);
    expect(slowDurationSec / fastDurationSec).toBeCloseTo(4, 1);

    // Position still lands exactly on the segment boundary at its cumTime.
    expect(tripPosition(trip, 8000)).toEqual(mid);
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
