import { useEffect, useMemo } from 'react';
import { Circle, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import type { LatLngTuple } from 'leaflet';
import { getMissionType } from '../../sim/data/missions';
import { remainingPath } from '../../sim/geo';
import { missionUnits, unitPosition, unitSpeedMph } from '../../sim/engine';
import type { Discipline, LatLng, Unit } from '../../sim/types';
import { useStore, type BaseLayer } from '../../store';
import { formatSpeed } from '../format';
import { missionIcon, searchIcon, shortCallsign, stationIcon, unitIcon } from './icons';

/** Salem, MO — default view until the player has a station. */
export const DEFAULT_CENTER: LatLng = { lat: 37.6456, lng: -91.5357 };

const BASE_LAYERS: Record<BaseLayer, { url: string; attribution: string; maxZoom: number }> = {
  streets: {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 20,
  },
  topo: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM | &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    maxZoom: 17,
  },
};

const tuple = (p: LatLng): LatLngTuple => [p.lat, p.lng];

// Leaflet doesn't update a path's className after creation, so colors go through pathOptions.
const AREA_COLOR: Record<Discipline, string> = { fire: '#dc2626', police: '#2563eb', ems: '#059669' };

export function MapView() {
  const placing = useStore((s) => s.ui.placing);
  const baseLayer = useStore((s) => s.settings.baseLayer);
  const initialCenter = useMemo(() => {
    const first = Object.values(useStore.getState().game.stations)[0];
    return first?.position ?? DEFAULT_CENTER;
  }, []);
  const layer = BASE_LAYERS[baseLayer];

  return (
    <div className={`map-wrap${placing ? ' is-placing' : ''}`}>
      <MapContainer center={tuple(initialCenter)} zoom={13} className="map" zoomControl={false} attributionControl>
        <TileLayer key={baseLayer} url={layer.url} attribution={layer.attribution} maxZoom={layer.maxZoom} />
        <MapController />
        <StationLayer />
        <RouteLayer />
        <MissionLayer />
        <UnitLayer />
        <SearchPin />
      </MapContainer>
      <SpeedHud />
    </div>
  );
}

/**
 * Live speedometer HUD pinned over the map. Tracks the fastest currently
 * moving unit assigned to the selected call, or — with no call selected —
 * the fastest moving unit anywhere, so there's always something to watch
 * right after a dispatch. Hidden whenever nothing is actually rolling.
 */
function SpeedHud() {
  const game = useStore((s) => s.game);
  const selectedMissionId = useStore((s) => s.ui.selectedMissionId);
  const mission = selectedMissionId ? game.missions[selectedMissionId] : null;
  const pool = mission ? missionUnits(game, mission) : Object.values(game.units);
  const moving = pool
    .map((unit) => ({ unit, speedMph: unitSpeedMph(unit, game.clock) }))
    .filter((u) => u.speedMph > 0)
    .sort((a, b) => b.speedMph - a.speedMph);
  if (moving.length === 0) return null;
  const lead = moving[0]!;

  const GAUGE_MAX_MPH = 80;
  const pct = Math.min(1, lead.speedMph / GAUGE_MAX_MPH);
  const theta = ((180 - pct * 180) * Math.PI) / 180;
  const needle: LatLngTuple = [60 + 42 * Math.cos(theta), 65 - 42 * Math.sin(theta)];
  const ARC_LEN = Math.PI * 50;

  return (
    <div className="speed-hud" role="status" aria-label={`${lead.unit.callsign} ${formatSpeed(lead.speedMph)}`}>
      <svg viewBox="0 0 120 70" width="104" height="61" aria-hidden="true">
        <path d="M10 65 A50 50 0 0 1 110 65" fill="none" stroke="var(--border)" strokeWidth="8" strokeLinecap="round" />
        <path
          d="M10 65 A50 50 0 0 1 110 65"
          fill="none"
          stroke="var(--orange)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${pct * ARC_LEN} ${ARC_LEN}`}
        />
        <line x1={60} y1={65} x2={needle[0]} y2={needle[1]} stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
        <circle cx={60} cy={65} r={4} fill="#fff" />
      </svg>
      <div className="speed-hud-reading">
        <strong>{Math.round(lead.speedMph)}</strong>
        <span>mph</span>
      </div>
      <div className="speed-hud-label">
        {lead.unit.callsign}
        {moving.length > 1 && ` +${moving.length - 1}`}
      </div>
    </div>
  );
}

function MapController() {
  const map = useMap();
  const flyTo = useStore((s) => s.ui.flyTo);
  useEffect(() => {
    if (!flyTo) return;
    // On phones the bottom sheet covers the lower part of the map; aim the
    // target at the centre of the part that's still visible.
    const covered = coveredBySheet(map.getContainer());
    const target = map.unproject(map.project(tuple(flyTo.position), flyTo.zoom).add([0, covered / 2]), flyTo.zoom);
    map.flyTo(target, flyTo.zoom, { duration: 0.8 });
  }, [flyTo, map]);
  useMapEvents({
    click(e) {
      const { ui, draftStationAt } = useStore.getState();
      if (ui.placing) draftStationAt({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

/** Pixels of the map hidden behind the (mobile) bottom sheet once it settles. */
function coveredBySheet(container: HTMLElement): number {
  if (!window.matchMedia('(max-width: 760px)').matches) return 0;
  const expanded = useStore.getState().ui.sheetExpanded;
  // Mirrors the .panel heights in styles.css (60dvh expanded, 104px collapsed).
  const sheetTop = window.innerHeight - (expanded ? window.innerHeight * 0.6 : 104);
  return Math.max(0, container.getBoundingClientRect().bottom - sheetTop);
}

function StationLayer() {
  const stations = useStore((s) => s.game.stations);
  const selectedId = useStore((s) => s.ui.selectedStationId);
  const selectStation = useStore((s) => s.selectStation);
  return (
    <>
      {Object.values(stations).map((st) => (
        <Circle
          key={`r-${st.id}`}
          center={tuple(st.position)}
          radius={st.responseRadiusKm * 1000}
          interactive={false}
          pathOptions={{
            color: AREA_COLOR[st.discipline],
            weight: st.id === selectedId ? 2 : 1,
            dashArray: '6 6',
            fillOpacity: st.id === selectedId ? 0.06 : 0.025,
          }}
        />
      ))}
      {Object.values(stations).map((st) => (
        <Marker
          key={st.id}
          position={tuple(st.position)}
          icon={stationIcon(st.discipline, st.id === selectedId)}
          zIndexOffset={-100}
          eventHandlers={{ click: () => selectStation(st.id) }}
        >
          <Tooltip direction="top" offset={[0, -16]}>
            {st.name}
          </Tooltip>
        </Marker>
      ))}
    </>
  );
}

function MissionLayer() {
  const missions = useStore((s) => s.game.missions);
  const selectedId = useStore((s) => s.ui.selectedMissionId);
  const selectMission = useStore((s) => s.selectMission);
  return (
    <>
      {Object.values(missions).map((m) => {
        const type = getMissionType(m.typeId);
        return (
          <Marker
            key={m.id}
            position={tuple(m.position)}
            icon={missionIcon(type.icon, m.status, m.id === selectedId)}
            zIndexOffset={m.id === selectedId ? 1000 : 500}
            eventHandlers={{ click: () => selectMission(m.id) }}
          >
            <Tooltip direction="top" offset={[0, -40]}>
              <strong>{type.name}</strong>
              <br />
              {m.address}
            </Tooltip>
          </Marker>
        );
      })}
    </>
  );
}

/**
 * Fan stationary units out around the marker they share, in screen pixels:
 * on scene around the call pin (whose visual centre sits above its tip),
 * turning out around the station. Ellipse because badges are wide.
 */
function fanOffsets(units: Unit[]): Map<string, [number, number]> {
  const groups = new Map<string, Unit[]>();
  for (const u of units) {
    const k = u.status === 'on_scene' ? `m:${u.missionId}` : `s:${u.stationId}`;
    groups.set(k, [...(groups.get(k) ?? []), u]);
  }
  const out = new Map<string, [number, number]>();
  for (const [k, group] of groups) {
    const onScene = k.startsWith('m:');
    const [cy, rx, ry] = onScene ? [-22, 50, 34] : [0, 50, 30];
    group.forEach((u, i) => {
      const a = (i * 2 * Math.PI) / group.length;
      out.set(u.id, [Math.round(Math.cos(a) * rx), Math.round(cy + Math.sin(a) * ry)]);
    });
  }
  return out;
}

function UnitLayer() {
  const units = useStore((s) => s.game.units);
  const clock = useStore((s) => s.game.clock);
  const selectMission = useStore((s) => s.selectMission);
  const selectStation = useStore((s) => s.selectStation);
  const visible = Object.values(units).filter((u) => u.status !== 'in_quarters');
  const offsets = fanOffsets(visible.filter((u) => u.status === 'on_scene' || u.status === 'dispatched'));
  return (
    <>
      {visible.map((u) => (
        <UnitMarker
          key={u.id}
          unit={u}
          position={unitPosition(u, clock)}
          speedMph={unitSpeedMph(u, clock)}
          offset={offsets.get(u.id)}
          onClick={() => (u.missionId ? selectMission(u.missionId) : selectStation(u.stationId))}
        />
      ))}
    </>
  );
}

function UnitMarker({
  unit,
  position,
  speedMph,
  offset,
  onClick,
}: {
  unit: Unit;
  position: LatLng;
  speedMph: number;
  offset?: [number, number];
  onClick: () => void;
}) {
  const icon = unitIcon(unit.specId, unit.status, shortCallsign(unit.callsign), offset);
  return (
    <Marker position={tuple(position)} icon={icon} zIndexOffset={800} eventHandlers={{ click: onClick }}>
      <Tooltip direction="top" offset={[(offset?.[0] ?? 0), (offset?.[1] ?? 0) - 12]}>
        {unit.callsign}
        {speedMph > 0 && <span className="tooltip-speed"> · {formatSpeed(speedMph)}</span>}
      </Tooltip>
    </Marker>
  );
}

function RouteLayer() {
  const units = useStore((s) => s.game.units);
  const clock = useStore((s) => s.game.clock);
  const selectedMissionId = useStore((s) => s.ui.selectedMissionId);
  return (
    <>
      {Object.values(units)
        .filter(
          (u) =>
            u.trip &&
            (u.status === 'en_route' || u.status === 'dispatched' || u.status === 'returning' || u.status === 'patrolling'),
        )
        .map((u) => {
          const returning = u.status === 'returning';
          const patrolling = u.status === 'patrolling';
          const selected = !returning && !patrolling && u.missionId === selectedMissionId;
          return (
            <Polyline
              key={u.id}
              positions={remainingPath(u.trip!, clock).map(tuple)}
              interactive={false}
              pathOptions={{
                color: patrolling ? '#2dd4bf' : returning ? '#93c5fd' : selected ? '#fb923c' : '#f97316',
                weight: selected ? 5 : 3,
                dashArray: patrolling || returning ? '4 8' : undefined,
                opacity: patrolling ? 0.35 : returning ? 0.5 : selected ? 0.95 : 0.6,
              }}
            />
          );
        })}
    </>
  );
}

function SearchPin() {
  const pin = useStore((s) => s.ui.searchPin);
  const draftStationAt = useStore((s) => s.draftStationAt);
  const setSearchPin = useStore((s) => s.setSearchPin);
  if (!pin) return null;
  return (
    <Marker
      position={tuple(pin.position)}
      icon={searchIcon()}
      eventHandlers={{ add: (e) => e.target.openPopup() }}
    >
      <Popup closeButton={false} autoPan>
        <div className="pin-popup">
          <div className="pin-label">{pin.label}</div>
          <div className="row gap">
            <button className="btn btn-primary btn-sm" onClick={() => draftStationAt(pin.position, pin.short)}>
              Place station here
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setSearchPin(null)}>
              Dismiss
            </button>
          </div>
        </div>
      </Popup>
    </Marker>
  );
}
