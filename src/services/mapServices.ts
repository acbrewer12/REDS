// Network-backed map services: geocoding (Nominatim) and road routing (OSRM).
//
// Both default to the free public OpenStreetMap endpoints, which are fine
// for a prototype but rate-limited (Nominatim: max 1 req/s). Point
// VITE_NOMINATIM_URL / VITE_OSRM_URL at a self-hosted or commercial
// instance before shipping. Every call degrades gracefully: geocoding falls
// back to coordinates, routing falls back to a straight-line estimate.

import { estimateRoute, type Route } from '../sim/engine';
import type { LatLng } from '../sim/types';

const NOMINATIM_URL = import.meta.env.VITE_NOMINATIM_URL ?? 'https://nominatim.openstreetmap.org';
const OSRM_URL = import.meta.env.VITE_OSRM_URL ?? 'https://router.project-osrm.org';
const TIMEOUT_MS = 6000;

/** Serialises requests to one host with a minimum spacing, per its usage policy. */
function rateLimiter(minSpacingMs: number) {
  let last: Promise<unknown> = Promise.resolve();
  let lastAt = 0;
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = last.then(async () => {
      const wait = lastAt + minSpacingMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastAt = Date.now();
      return fn();
    });
    last = run.catch(() => undefined);
    return run;
  };
}

const nominatimQueue = rateLimiter(1100);
const osrmQueue = rateLimiter(250);

async function fetchJson<T>(url: string): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export const formatLatLng = (p: LatLng) => `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;

// ── Geocoding ──────────────────────────────────────────────────────────

interface NominatimAddress {
  house_number?: string;
  road?: string;
  hamlet?: string;
  village?: string;
  town?: string;
  city?: string;
  county?: string;
  state?: string;
  'ISO3166-2-lvl4'?: string;
}

interface NominatimPlace {
  lat: string;
  lon: string;
  display_name: string;
  address?: NominatimAddress;
}

export interface GeocodeResult {
  position: LatLng;
  label: string;
  /** Short CAD-style address, e.g. "1203 S Main St, Salem, MO". */
  short: string;
}

/** "1203 S Main St, Salem, MO" from Nominatim's structured address. */
export function shortAddress(a: NominatimAddress | undefined, fallback: string): string {
  if (!a) return fallback;
  const street = [a.house_number, a.road].filter(Boolean).join(' ');
  const place = a.city ?? a.town ?? a.village ?? a.hamlet ?? a.county;
  const state = a['ISO3166-2-lvl4']?.split('-')[1] ?? a.state;
  const parts = [street, place, state].filter(Boolean);
  return parts.length ? parts.join(', ') : fallback;
}

export async function searchAddress(query: string): Promise<GeocodeResult[]> {
  const q = encodeURIComponent(query.trim());
  if (!q) return [];
  const places = await nominatimQueue(() =>
    fetchJson<NominatimPlace[]>(`${NOMINATIM_URL}/search?format=jsonv2&addressdetails=1&limit=6&q=${q}`),
  );
  return places.map((p) => ({
    position: { lat: Number(p.lat), lng: Number(p.lon) },
    label: p.display_name,
    short: shortAddress(p.address, p.display_name),
  }));
}

export async function reverseGeocode(p: LatLng): Promise<string> {
  try {
    const place = await nominatimQueue(() =>
      fetchJson<NominatimPlace & { error?: string }>(
        `${NOMINATIM_URL}/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=${p.lat}&lon=${p.lng}`,
      ),
    );
    if (place.error) return formatLatLng(p);
    return shortAddress(place.address, place.display_name ?? formatLatLng(p));
  } catch {
    return formatLatLng(p);
  }
}

// ── Routing ────────────────────────────────────────────────────────────

interface OsrmRouteResponse {
  code: string;
  routes?: {
    distance: number;
    duration: number;
    geometry: { coordinates: [number, number][] };
    legs?: { annotation?: { duration?: number[] } }[];
  }[];
}

interface OsrmNearestResponse {
  code: string;
  waypoints?: { location: [number, number]; distance: number }[];
}

const routeCache = new Map<string, Route>();
const key = (p: LatLng) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`;

/**
 * Driving route from `from` to `to`. Cached (units from one station share a
 * route to the same call) and reused in reverse for the trip home.
 */
export async function getRoute(from: LatLng, to: LatLng, useRoads: boolean): Promise<Route> {
  if (!useRoads) return estimateRoute(from, to);
  const k = `${key(from)};${key(to)}`;
  const cached = routeCache.get(k);
  if (cached) return cached;
  const reverse = routeCache.get(`${key(to)};${key(from)}`);
  if (reverse) {
    return {
      ...reverse,
      path: [...reverse.path].reverse(),
      segDurationsSec: reverse.segDurationsSec ? [...reverse.segDurationsSec].reverse() : undefined,
    };
  }

  try {
    const data = await osrmQueue(() =>
      // annotations=true gives per-segment duration alongside the geometry,
      // one entry per consecutive coordinate pair — lets a trip's displayed
      // speed vary with the actual road instead of being one flat average
      // over the whole route (see Route.segDurationsSec / unitSpeedMph).
      fetchJson<OsrmRouteResponse>(`${OSRM_URL}/route/v1/driving/${k}?overview=full&geometries=geojson&annotations=true`),
    );
    const r = data.routes?.[0];
    if (data.code !== 'Ok' || !r) throw new Error(data.code);
    const route: Route = {
      path: r.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
      distanceM: r.distance,
      carDurationSec: r.duration,
      source: 'road',
      segDurationsSec: r.legs?.[0]?.annotation?.duration,
    };
    if (routeCache.size > 500) routeCache.clear();
    routeCache.set(k, route);
    return route;
  } catch {
    return estimateRoute(from, to);
  }
}

/**
 * Snap a point to the nearest drivable road, so generated calls land where
 * an engine can actually reach them. Returns the input on failure, or when
 * the nearest road is implausibly far (e.g. deep in a lake).
 */
export async function snapToRoad(p: LatLng, useRoads: boolean): Promise<LatLng> {
  if (!useRoads) return p;
  try {
    const data = await osrmQueue(() =>
      fetchJson<OsrmNearestResponse>(`${OSRM_URL}/nearest/v1/driving/${key(p)}?number=1`),
    );
    const w = data.waypoints?.[0];
    if (data.code !== 'Ok' || !w || w.distance > 2000) return p;
    return { lat: w.location[1], lng: w.location[0] };
  } catch {
    return p;
  }
}
