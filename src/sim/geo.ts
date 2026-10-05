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

/** Where a unit on `trip` is at sim time `t`. Constant speed between departAt and arriveAt. */
export function tripPosition(trip: Trip, t: number): LatLng {
  const total = trip.cumDist.at(-1) ?? 0;
  if (t <= trip.departAt) return trip.path[0]!;
  if (t >= trip.arriveAt) return trip.path.at(-1)!;
  const f = (t - trip.departAt) / (trip.arriveAt - trip.departAt);
  return pointAlongPath(trip.path, trip.cumDist, total * f);
}

/** Remaining portion of a trip's path from sim time `t` (used to draw route lines). */
export function remainingPath(trip: Trip, t: number): LatLng[] {
  const total = trip.cumDist.at(-1) ?? 0;
  if (t <= trip.departAt) return trip.path;
  const f = Math.min(1, (t - trip.departAt) / Math.max(1, trip.arriveAt - trip.departAt));
  const d = total * f;
  const rest = trip.path.filter((_, i) => trip.cumDist[i]! > d);
  return [pointAlongPath(trip.path, trip.cumDist, d), ...rest];
}

export function formatDistance(meters: number): string {
  const miles = meters / 1609.344;
  return miles < 0.1 ? `${Math.round(meters * 3.28084)} ft` : `${miles.toFixed(1)} mi`;
}
