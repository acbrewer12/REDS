# REDS — Realistic Emergency Dispatch Sim

A fire / police dispatch game on the **real map**. Put stations at real addresses, staff them with apparatus built from real spec sheets (pump GPM, tank gallons, NWCG typing), and dispatch them to calls that land on real roads in your first-due area.

The web app is responsive (desktop side panel, phone bottom sheet) so one codebase covers both. It can be wrapped as an Android app with Capacitor once the web version is solid.

## Status: Milestone 1 — single-station loop ✅

You can do the whole loop:

1. **Place a station.** Search a real address (OpenStreetMap / Nominatim) or click the map. Pick a starting fleet. The Dent County FPD (Salem, MO) preset is the default.
2. **Calls come in** inside the station's first-due radius. Each one is snapped to the nearest drivable road and reverse-geocoded to a CAD-style address, e.g. "1788 County Road 238, Dent County, MO". You only get call types your fleet can actually handle.
3. **Dispatch manually.** Available units are listed by estimated ETA, which includes crew turnout time. *Select recommended* pre-checks the closest units that cover the call; you confirm the dispatch.
4. **Units drive real roads** (OSRM) through CAD statuses: `DP` turnout → `ER` en route → `OS` on scene.
5. **Work progresses** only while the on-scene units meet the requirement: unit roles, total tank water, and personnel.
6. **Mark complete.** Units go `AV` (returning) and drive home, where they become available again. Units that are driving home can be reassigned on the way.

The save lives in `localStorage` and persists across reloads.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine unit tests (Vitest)
npm run typecheck
npm run build      # static bundle in dist/
```

Requires Node 20.19+.

## How it's built

```
src/
  sim/                 Pure TypeScript simulation. No React, no network, no clock.
    types.ts           Data model (stations, units, trips, missions, CAD log)
    engine.ts          State → state functions: addStation, dispatchUnit, tick, closeMission…
    requirements.ts    Unit ↔ requirement matching (bipartite), recommendations
    geo.ts             Haversine, path interpolation, random points in radius
    data/apparatus.ts  Apparatus catalog with real specs
    data/missions.ts   Call types and their requirements
    data/presets.ts    Fleet presets (Dent County FPD, generic rural/career/PD)
  services/
    mapServices.ts     Nominatim geocoding + OSRM routing, rate-limited, cached, with fallbacks
  store.ts             Zustand store: wires engine ↔ services ↔ UI, persistence, game loop
  ui/                  React components (Leaflet map, panels, dialogs)
```

The engine is deliberately framework-free and deterministic: routes and RNG are passed in. That keeps it unit-testable, and it can later move to a server for a persistent multi-device account without a rewrite.

### Realism notes

- **Apparatus** (`src/sim/data/apparatus.ts`) follows the NWCG *Standards for Wildland Fire Resource Typing* (PMS 200) minimums:

  | Engine type     | 1     | 2   | 3   | 4   | 5   | 6   | 7   |
  | --------------- | ----- | --- | --- | --- | --- | --- | --- |
  | Pump (gpm)      | 1,000 | 500 | 150 | 50  | 50  | 50  | 10  |
  | Tank (gal)      | 300   | 300 | 500 | 750 | 400 | 150 | 50  |
  | Min. personnel  | 4     | 3   | 3   | 2   | 2   | 2   | 2   |

  Water tenders follow the same standard: Tactical Type 1/2 and Support Type 1/2. Structural rigs also follow NFPA 1901/1900, for example the pumper's minimum of 750 gpm. Where a catalog entry beats the NWCG minimum (a 1,250 gpm / 750 gal Type 1, for example), it models a typical in-service rig.
- **Requirements are capabilities, not just unit names.** A rural residential fire needs 2 engines, 1 tanker, 2,500 gal of water and 8 people on scene. A quint can fill an engine slot *or* a ladder slot, but not both. Matching uses an exact bipartite algorithm.
- **Turnout time** depends on staffing: career 80 s (the NFPA 1710 benchmark), combination 150 s, volunteer 300 s, police 30 s.
- **Travel time** is the OSRM car drive time multiplied by a per-vehicle factor. A patrol car is about 0.8× (faster than traffic); a loaded 4,000 gal tanker is about 1.3×. Return trips are non-emergency and run slower.

## Reference data — what's real and what's a placeholder

The Dent County FPD preset uses the district's unit designations: **Engine 8010, 8020, 8030** and **Ladder 8012**. These parts are **placeholders to verify**:

- which spec each rig maps to (e.g. Engine 8010 = Type 1, Ladder 8012 = 75 ft quint);
- the tanker and brush unit numbers (currently `Tanker 1/2`, `Brush 1/2`);
- the Salem PD roster (the preset is a generic small-town PD).

To drop in the real data, edit `src/sim/data/presets.ts`, or rename units in-game (click a callsign on the station screen). The station address isn't hardcoded: you place it yourself on the map.

## Map services

| Service        | Default (free, public)              | Notes                                                        |
| -------------- | ----------------------------------- | ------------------------------------------------------------ |
| Tiles          | OpenStreetMap, CARTO Dark, OpenTopoMap | Switch in ⚙ settings. Attribution shown on the map.        |
| Geocoding      | `nominatim.openstreetmap.org`       | Max 1 req/s (enforced client-side). Falls back to coordinates. |
| Routing / snap | `router.project-osrm.org` (demo)    | Falls back to straight-line × 1.35 at 64 km/h if unreachable. |

The public endpoints are fine for development but **not for production traffic**. Before shipping, set `VITE_NOMINATIM_URL` / `VITE_OSRM_URL` (see `.env.example`) to self-hosted or commercial instances (e.g. MapTiler, Mapbox, Stadia, or your own OSRM). Road routing can also be switched off in ⚙ settings.

## Roadmap

- **M2 — Multi-region.** Several stations at once, anywhere in the world (Salem + Alaska). Add *dispatch centers*: stations grouped by region, each with its own call pool and unit pool, so distant regions don't interfere. Mutual aid between neighbouring centers is an explicit choice. The data model already stores everything keyed by id, so the work here is mainly region scoping in call generation and candidate filtering.
- **M3 — Auto-dispatch AI.** Analyze each call (required roles, water, personnel, distance, availability) and *actually assign* units, with a manual override. `recommendUnits()` already finds the closest set that covers a call. Next steps: road-ETA ranking, keeping coverage (don't strip a district bare), and move-ups.
- **M4 — Depth.** Calls that escalate when left unattended (a grass fire becomes a woodland fire), a credit economy for buying stations and apparatus, patrol units that roam beats instead of waiting in quarters, and a tanker shuttle / water-supply model.
- **M5 — Accounts & Android.** Server-side persistence for one save across devices, then a Capacitor wrapper. `vite.config.ts` already uses a relative `base`, so the bundle runs from `capacitor://`.
