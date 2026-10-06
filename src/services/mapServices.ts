// Network-backed map services: geocoding (Nominatim), road routing (OSRM),
// and posted speed limits (Overpass, OpenStreetMap's data-query API).
//
// All default to the free public OpenStreetMap endpoints, which are fine
// for a prototype but rate-limited (Nominatim: max 1 req/s). Point
// VITE_NOMINATIM_URL / VITE_OSRM_URL / VITE_OVERPASS_URL at a self-hosted or
// commercial instance before shipping. Every call degrades gracefully:
// geocoding falls back to coordinates, routing falls back to a
// straight-line estimate, speed limits fall back to OSRM's own modeled pace
// for the road's class.

import { estimateRoute, type Route } from '../sim/engine';
import { haversineMeters } from '../sim/geo';
import type { LatLng } from '../sim/types';

const NOMINATIM_URL = import.meta.env.VITE_NOMINATIM_URL ?? 'https://nominatim.openstreetmap.org';
const OSRM_URL = import.meta.env.VITE_OSRM_URL ?? 'https://router.project-osrm.org';
const OVERPASS_URL = import.meta.env.VITE_OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter';
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
const overpassQueue = rateLimiter(1500);

async function fetchJson<T>(url: string, timeoutMs = TIMEOUT_MS): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
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
    const path = r.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
    const segDurationsSec = r.legs?.[0]?.annotation?.duration ? [...r.legs[0].annotation.duration] : undefined;
    // Overlay actual posted speed limits where OpenStreetMap has the road
    // tagged, in place of OSRM's own modeled-by-road-class pace. Best
    // effort: silently keeps OSRM's numbers for any segment with no tagged
    // limit nearby, or if Overpass is slow/unreachable entirely.
    if (segDurationsSec) {
      try {
        await applySpeedLimits(path, segDurationsSec);
      } catch {
        // keep the OSRM-modeled durations
      }
    }
    const route: Route = {
      path,
      distanceM: r.distance,
      carDurationSec: r.duration,
      source: 'road',
      segDurationsSec,
    };
    if (routeCache.size > 500) routeCache.clear();
    routeCache.set(k, route);
    return route;
  } catch {
    return estimateRoute(from, to);
  }
}

// ── Posted speed limits (Overpass) ────────────────────────────────────

interface OverpassWay {
  type: string;
  tags?: { maxspeed?: string };
  geometry?: { lat: number; lon: number }[];
}

interface OverpassResponse {
  elements?: OverpassWay[];
}

/** "55 mph" → 55; "90" or "90 km/h" → ~56 (bare numbers are km/h per OSM convention); anything else (a zone name like "national", "signals", unparsable) → undefined, so that segment just keeps OSRM's modeled pace. */
export function parseMaxspeedMph(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const m = raw.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(mph|km\/h|kmh)?$/);
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return m[2] === 'mph' ? n : n * 0.621371;
}

/** Shortest distance (meters) from `p` to the segment `a`–`b`, via a local flat-earth projection (fine at road-matching scale, tens of meters). */
export function distanceToSegmentM(p: LatLng, a: LatLng, b: LatLng): number {
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos((p.lat * Math.PI) / 180);
  const px = (p.lng - a.lng) * mPerDegLng;
  const py = (p.lat - a.lat) * mPerDegLat;
  const bx = (b.lng - a.lng) * mPerDegLng;
  const by = (b.lat - a.lat) * mPerDegLat;
  const lenSq = bx * bx + by * by;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, (px * bx + py * by) / lenSq));
  return Math.hypot(px - bx * t, py - by * t);
}

/** Shortest distance (meters) from `p` to any segment of `way`. */
export function distanceToWayM(p: LatLng, way: LatLng[]): number {
  let min = Infinity;
  for (let i = 1; i < way.length; i++) min = Math.min(min, distanceToSegmentM(p, way[i - 1]!, way[i]!));
  return min;
}

/** A road is matched to a route segment only this close to it — otherwise it's some other nearby street, not the one being driven. */
const SPEED_LIMIT_MATCH_M = 25;

/**
 * Mutates `segDurationsSec` in place: for each segment of `path` whose
 * midpoint sits on a tagged OSM road, replaces OSRM's modeled duration with
 * one derived from that road's real posted limit (distance ÷ speed).
 * Queries Overpass once for every tagged road in the route's bounding box,
 * then matches locally — one network round trip per route, not per segment.
 */
async function applySpeedLimits(path: LatLng[], segDurationsSec: number[]): Promise<void> {
  if (path.length < 2) return;
  const pad = 0.003; // ~300m — covers a tagged way's own geometry extending past our path's bbox
  let south = path[0]!.lat;
  let north = path[0]!.lat;
  let west = path[0]!.lng;
  let east = path[0]!.lng;
  for (const p of path) {
    south = Math.min(south, p.lat);
    north = Math.max(north, p.lat);
    west = Math.min(west, p.lng);
    east = Math.max(east, p.lng);
  }
  const query = `[out:json][timeout:10];way["highway"]["maxspeed"](${south - pad},${west - pad},${north + pad},${east + pad});out geom;`;
  const data = await overpassQueue(() =>
    fetchJson<OverpassResponse>(`${OVERPASS_URL}?data=${encodeURIComponent(query)}`, 9000),
  );
  const ways = (data.elements ?? [])
    .map((w) => ({
      mph: parseMaxspeedMph(w.tags?.maxspeed),
      path: w.geometry?.map((g) => ({ lat: g.lat, lng: g.lon })) ?? [],
    }))
    .filter((w): w is { mph: number; path: LatLng[] } => w.mph !== undefined && w.path.length >= 2);
  if (ways.length === 0) return;

  for (let i = 0; i < path.length - 1; i++) {
    const mid: LatLng = { lat: (path[i]!.lat + path[i + 1]!.lat) / 2, lng: (path[i]!.lng + path[i + 1]!.lng) / 2 };
    let bestMph: number | undefined;
    let bestDist = SPEED_LIMIT_MATCH_M;
    for (const way of ways) {
      const d = distanceToWayM(mid, way.path);
      if (d < bestDist) {
        bestDist = d;
        bestMph = way.mph;
      }
    }
    if (bestMph !== undefined) {
      const segDistM = haversineMeters(path[i]!, path[i + 1]!);
      segDurationsSec[i] = segDistM / (bestMph * 0.44704);
    }
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
