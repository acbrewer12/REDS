# REDS — Realistic Emergency Dispatch Sim

A fire / police dispatch game on the **real map**. Put stations at real addresses, staff them with apparatus built from real spec sheets (pump GPM, tank gallons, NWCG typing), and dispatch them to calls that land on real roads in your first-due area.

The web app is responsive (desktop side panel, phone bottom sheet) so one codebase covers both. It can be wrapped as an Android app with Capacitor once the web version is solid.

## Status: Milestone 1 ✅ + Milestone 2 — multi-region dispatch centers ✅ + Milestone 3 — auto-dispatch AI ✅

You can do the whole loop:

1. **Place a station.** Search a real address (OpenStreetMap / Nominatim) or click the map. Pick a starting fleet. The Dent County FPD (Salem, MO) preset is the default.
2. **Calls come in** inside the station's first-due radius. Each one is snapped to the nearest drivable road and reverse-geocoded to a CAD-style address, e.g. "1788 County Road 238, Dent County, MO". You only get call types your fleet can actually handle.
3. **Dispatch manually, or flip on auto-dispatch.** Available units are listed by estimated ETA, which includes crew turnout time. *Select recommended* pre-checks the closest units that cover the call; you confirm the dispatch. Or turn on **Auto-dispatch** in ⚙ settings and the same recommended set is assigned to every call on its own — see Milestone 3 below. The two aren't exclusive: with auto-dispatch on you can still manually dispatch extra units or release ones it sent.
4. **Units drive real roads** (OSRM) through CAD statuses: `DP` turnout → `ER` en route → `OS` on scene.
5. **Work progresses** only while the on-scene units meet the requirement: unit roles, total tank water, and personnel.
6. **Mark complete.** Units go `AV` (returning) and drive home, where they become available again. Units that are driving home can be reassigned on the way.

Place a second station anywhere — Salem and an "Alaska" region at the same time, for instance — and each **dispatch center** keeps its own independent call pool and dispatch-eligible unit pool; see Milestone 2 below.

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
    types.ts           Data model (dispatch centers, stations, units, trips, missions, CAD log)
    engine.ts          State → state functions: addDispatchCenter, addStation, dispatchUnit, tick, closeMission…
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

## Multi-region dispatch centers (Milestone 2)

A **dispatch center** is a named group of stations that share one call pool and one dispatch-eligible unit pool. Placing a station offers a choice:

- **Join an existing center** — the new station's units become available for every other station's calls in that center, and vice versa. This is the explicit "opt in to mutual aid" action; the dialog defaults to this when the new station is within ~150 km of an existing one.
- **Start a new dispatch center** — an independent region with its own calls and units, invisible to every other center. The dialog defaults to this for a far-away placement (e.g. adding an "Alaska" region alongside Salem, MO).

Under the hood (`src/sim/engine.ts`):

- `GameState.dispatchCenters` holds the centers; every `Station` has a `centerId`.
- `eligibleMissionTypes()` — which call types a station's area can generate — now matches against `unitsInCenter()`, the pooled fleet of every station in that *center*, not the whole game's fleet. A lone two-officer PD in one center can't suddenly field a call that needs a ladder truck three states away.
- The dispatch panel's "available units" list is scoped the same way: a mission only offers units from stations in its own center as candidates.
- Removing the last station in a center drops the now-empty center.
- Old saves (pre-M2) migrate automatically into one legacy center on load, so nothing breaks.

Within one center, call generation is still per-station (each station's own first-due radius decides where its calls land), so this doesn't change single-station behavior — it only stops two *unrelated* regions from leaking calls or units into each other.

## Auto-dispatch AI (Milestone 3)

Turn on **Auto-dispatch** in ⚙ settings (off by default) and every open call is handled the same way "Select recommended" + Dispatch would, without you touching it:

- Once a second, the pass (`autoDispatchPass` in `src/store.ts`) walks every call that isn't fully covered yet, **oldest first**, so an older call isn't repeatedly leapfrogged by a newer one competing for the same nearby units.
- For each one it calls `candidatesForMission()` (`src/sim/engine.ts`) for the ranked, center-scoped pool of available units, then `recommendUnits()` (already powering "Select recommended") to pick the set that covers the requirement, and dispatches them.
- **Keeping coverage:** within an ETA/suitability tier, `candidatesForMission` pushes a unit to the back of the list if it's the *only* available unit in the center that can fill one of its roles — so a borderline grass fire doesn't reflexively take a district's last brush truck when a backed-up engine would do. It still takes the sole-cover unit when nothing else can fill the slot; a call doesn't go uncovered for the sake of keeping a reserve.
- Manual dispatch and release work exactly as before, any time — auto-dispatch only fills in gaps a human hasn't gotten to, and a mission already busy with an in-flight manual dispatch is skipped for that pass.

**Not yet built:** real road-ETA ranking for the auto pass (it uses the same straight-line estimate "Select recommended" shows before you confirm — good enough to rank candidates, not to show a trustworthy ETA on its own) and move-ups (shifting a unit to cover a newly-undercovered first-due area after a dispatch, rather than just reacting call-by-call).

## Reference data — what's real and what's a placeholder

**Dent County FPD** (`dent-county-fpd` preset) is real, sourced data: station at 2 South Main Street, Salem, MO 65560 (United Way 211 directory; Fire Chief Dennis Floyd), and the full apparatus roster — Engine 8010/8020/8030, Ladder 8012, Pumper Tankers 8013/8023, Rescue 8016, Brush 8018/8028/8038, Truck 8026 — sourced from the district's own Facebook post and a community fire-apparatus roster. Two things are flagged **provisional** in `src/sim/data/apparatus.ts` rather than presented as confirmed:

- **Engine 8030** (1996 Freightliner) may already be retired or transferred under the district's bond-funded "Proposition Fire" apparatus-replacement program; its pump GPM and crew size are estimates from comparable-era rigs, not this unit's own spec sheet.
- Two **2025 Ford F-350 brush trucks** are on order, not yet in service — modeled as `dcfpd-brush-pending-350` but left out of the default fleet until delivered.

**Salem Police Department** (`salem-pd` preset) is also real, sourced data: station at 500 North Jackson St, Salem, MO 65560, Chief Joe Chase, 12 sworn officers (Missouri UCR/NIBRS, ORI MO0330100), serving a population of 4,736. The in-game fleet starts at the one patrol car the department actually runs; growing it to 2–6 patrol units is realistic for a department this size, anything bigger (SWAT, K9, federal-scale units) is not.

The `rural-fire-basic`, `career-fire`, and `small-town-pd` presets remain generic, not tied to a real department. To edit any of this, change `src/sim/data/presets.ts` / `data/apparatus.ts`, or rename units in-game (click a callsign on the station screen). The station address isn't hardcoded: you place it yourself on the map.

## Map services

| Service        | Default (free, public)              | Notes                                                        |
| -------------- | ----------------------------------- | ------------------------------------------------------------ |
| Tiles          | OpenStreetMap, CARTO Dark, OpenTopoMap | Switch in ⚙ settings. Attribution shown on the map.        |
| Geocoding      | `nominatim.openstreetmap.org`       | Max 1 req/s (enforced client-side). Falls back to coordinates. |
| Routing / snap | `router.project-osrm.org` (demo)    | Falls back to straight-line × 1.35 at 64 km/h if unreachable. |

The public endpoints are fine for development but **not for production traffic**. Before shipping, set `VITE_NOMINATIM_URL` / `VITE_OSRM_URL` (see `.env.example`) to self-hosted or commercial instances (e.g. MapTiler, Mapbox, Stadia, or your own OSRM). Road routing can also be switched off in ⚙ settings.

## Roadmap

- **M2 — Multi-region ✅.** Several stations at once, anywhere in the world (Salem + Alaska). *Dispatch centers* group stations by region, each with its own call pool and unit pool, so distant regions don't interfere; mutual aid between neighbouring centers is an explicit choice made when placing a station. See "Multi-region dispatch centers" above.
- **M3 — Auto-dispatch AI ✅.** An opt-in setting that analyzes each open call (required roles, water, personnel, distance, availability) and assigns the recommended units automatically, oldest call first, while keeping a center from being stripped of its last unit of a kind when a backed-up one would do. Manual dispatch and release still work any time. See "Auto-dispatch AI" above. Still to come: real road-ETA ranking for the auto pass, and move-ups (repositioning a unit to cover a newly-thin first-due area rather than reacting call-by-call).
- **M4 — Depth.** Calls that escalate when left unattended (a grass fire becomes a woodland fire), a credit economy for buying stations and apparatus, patrol units that roam beats instead of waiting in quarters, and a tanker shuttle / water-supply model.
- **M5 — Accounts & Android.** Server-side persistence for one save across devices, then a Capacitor wrapper. `vite.config.ts` already uses a relative `base`, so the bundle runs from `capacitor://`.
