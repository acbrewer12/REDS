import { describe, expect, it } from 'vitest';
import { distanceToSegmentM, distanceToWayM, parseMaxspeedMph } from './mapServices';

describe('parseMaxspeedMph', () => {
  it('parses an explicit mph tag', () => {
    expect(parseMaxspeedMph('55 mph')).toBe(55);
    expect(parseMaxspeedMph('25mph')).toBe(25);
    expect(parseMaxspeedMph('25 MPH')).toBe(25);
  });

  it('treats a bare number or an explicit km/h tag as km/h, per OSM convention', () => {
    expect(parseMaxspeedMph('90')).toBeCloseTo(55.92, 1);
    expect(parseMaxspeedMph('90 km/h')).toBeCloseTo(55.92, 1);
  });

  it('returns undefined for zone names, missing tags, or garbage', () => {
    expect(parseMaxspeedMph('national')).toBeUndefined();
    expect(parseMaxspeedMph('signals')).toBeUndefined();
    expect(parseMaxspeedMph('RU:urban')).toBeUndefined();
    expect(parseMaxspeedMph(undefined)).toBeUndefined();
    expect(parseMaxspeedMph('0')).toBeUndefined();
    expect(parseMaxspeedMph('-5')).toBeUndefined();
  });
});

describe('distanceToSegmentM / distanceToWayM', () => {
  const a = { lat: 37.6456, lng: -91.5357 };
  const b = { lat: 37.6456, lng: -91.52 }; // due east of a, same latitude

  it('is ~0 for a point on the segment', () => {
    const mid = { lat: 37.6456, lng: (a.lng + b.lng) / 2 };
    expect(distanceToSegmentM(mid, a, b)).toBeLessThan(1);
  });

  it('measures perpendicular offset for a point beside the segment', () => {
    // ~0.001 deg north of the midpoint ≈ 111m away.
    const beside = { lat: 37.6466, lng: (a.lng + b.lng) / 2 };
    const d = distanceToSegmentM(beside, a, b);
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(120);
  });

  it('clamps to the nearest endpoint past the segment ends', () => {
    const pastB = { lat: 37.6456, lng: -91.5 };
    expect(distanceToSegmentM(pastB, a, b)).toBeCloseTo(distanceToSegmentM(pastB, b, b), 0);
  });

  it('picks the closest of a way’s several segments', () => {
    const way = [a, b, { lat: 37.65, lng: -91.52 }];
    const nearSecondSeg = { lat: 37.648, lng: -91.52 };
    const d = distanceToWayM(nearSecondSeg, way);
    expect(d).toBeLessThan(distanceToSegmentM(nearSecondSeg, a, b));
  });
});
