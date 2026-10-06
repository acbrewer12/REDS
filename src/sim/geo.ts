import type { LatLng, Trip } from './types';

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Great-circle distance in meters. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Point reached travelling `distanceM` from `origin` on `bearingDeg`. */
export function destinationPoint(origin: LatLng, distanceM: number, bearingDeg: number): LatLng {
  const δ = distanceM / EARTH_RADIUS_M;
  const θ = toRad(bearingDeg);
  const φ1 = toRad(origin.lat);
  const λ1 = toRad(origin.lng);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: toDeg(φ2), lng: ((toDeg(λ2) + 540) % 360) - 180 };
}

/** Uniformly distributed random point inside a circle (not clustered at the centre). */
export function randomPointInRadius(center: LatLng, radiusM: number, rng: () => number, minM = 0): LatLng {
  const r = Math.sqrt(rng() * (radiusM ** 2 - minM ** 2) + minM ** 2);
  return destinationPoint(center, r, rng() * 360);
}

export function cumulativeDistances(path: LatLng[]): number[] {
  const out = [0];
  for (let i = 1; i < path.length; i++) out.push(out[i - 1]! + haversineMeters(path[i - 1]!, path[i]!));
  return out;
}

export function pathLength(path: LatLng[]): number {
  return cumulativeDistances(path).at(-1) ?? 0;
}

/** Position `distanceM` along a path with precomputed cumulative distances. */
export function pointAlongPath(path: LatLng[], cumDist: number[], distanceM: number): LatLng {
  if (path.length === 0) throw new Error('empty path');
  if (distanceM <= 0) return path[0]!;
  const total = cumDist.at(-1)!;
  if (distanceM >= total) return path.at(-1)!;
  // Binary search for the segment containing distanceM.
  let lo = 0;
  let hi = cumDist.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cumDist[mid]! <= distanceM) lo = mid;
    else hi = mid;
  }
  const segLen = cumDist[hi]! - cumDist[lo]!;
  const f = segLen === 0 ? 0 : (distanceM - cumDist[lo]!) / segLen;
  const a = path[lo]!;
  const b = path[hi]!;
  return { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f };
}

/**
 * Per-vertex cumulative time (ms), built from per-segment weights in any
 * consistent unit (seconds of real road duration, or meters as a
 * distance-proportional/constant-speed stand-in), rescaled so the total
 * always equals `totalMs` exactly — a trip's own pacing (turnout,
 * lights-and-siren vs. legal-speed, etc.) can change its total duration
 * without changing the road's shape. Missing or non-positive weights fall
 * back to that segment's share of the total distance.
 */
export function buildCumTime(cumDist: number[], weights: (number | undefined)[] | undefined, totalMs: number): number[] {
  const segCount = cumDist.length - 1;
  if (segCount <= 0) return [0];
  const w: number[] = new Array(segCount);
  for (let i = 0; i < segCount; i++) {
    const own = weights?.[i];
    w[i] = own !== undefined && own > 0 ? own : Math.max(cumDist[i + 1]! - cumDist[i]!, 1e-9);
  }
  const total = w.reduce((a, b) => a + b, 0);
  const cumTime = [0];
  let acc = 0;
  for (let i = 0; i < segCount; i++) {
    acc += w[i]!;
    cumTime.push(total > 0 ? (acc / total) * totalMs : ((i + 1) / segCount) * totalMs);
  }
  return cumTime;
}

/** Segment index `i` (so `t` falls between `path[i]` and `path[i+1]`) + the local fraction within it. */
function tripSegment(trip: Trip, t: number): { i: number; f: number } {
  const cumTime = trip.cumTime;
  const elapsed = Math.min(cumTime.at(-1) ?? 0, Math.max(0, t - trip.departAt));
  if (cumTime.length < 2) return { i: 0, f: 0 };
  let lo = 0;
  let hi = cumTime.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cumTime[mid]! <= elapsed) lo = mid;
    else hi = mid;
  }
  const segLen = cumTime[hi]! - cumTime[lo]!;
  return { i: lo, f: segLen === 0 ? 0 : (elapsed - cumTime[lo]!) / segLen };
}

/**
 * Where a unit on `trip` is at sim time `t`. Speed can vary segment to
 * segment (see `Trip.cumTime` — a real road route's segments are timed from
 * its own per-segment data, not one flat trip-average), interpolated
 * linearly within whichever segment `t` currently falls in.
 */
export function tripPosition(trip: Trip, t: number): LatLng {
  if (t <= trip.departAt) return trip.path[0]!;
  if (t >= trip.arriveAt) return trip.path.at(-1)!;
  const { i, f } = tripSegment(trip, t);
  const a = trip.path[i]!;
  const b = trip.path[Math.min(i + 1, trip.path.length - 1)]!;
  return { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f };
}

/** Remaining portion of a trip's path from sim time `t` (used to draw route lines). */
export function remainingPath(trip: Trip, t: number): LatLng[] {
  if (t <= trip.departAt) return trip.path;
  const { i, f } = tripSegment(trip, t);
  const a = trip.path[i]!;
  const b = trip.path[Math.min(i + 1, trip.path.length - 1)]!;
  const here = { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f };
  return [here, ...trip.path.slice(i + 1)];
}

/**
 * The road segment a trip is on right now — [distanceM, durationSec] — for a
 * live, locally-accurate speed reading (see `unitSpeedMph`) instead of one
 * flat trip-average.
 */
export function tripCurrentSegment(trip: Trip, t: number): [number, number] {
  const { i } = tripSegment(trip, t);
  const j = Math.min(i + 1, trip.path.length - 1);
  const distM = trip.cumDist[j]! - trip.cumDist[i]!;
  const timeMs = trip.cumTime[j]! - trip.cumTime[i]!;
  return [distM, timeMs / 1000];
}

export function formatDistance(meters: number): string {
  const miles = meters / 1609.344;
  return miles < 0.1 ? `${Math.round(meters * 3.28084)} ft` : `${miles.toFixed(1)} mi`;
}
