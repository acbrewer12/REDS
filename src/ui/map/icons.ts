import L from 'leaflet';
import { getSpec, ROLE_BADGE } from '../../sim/data/apparatus';
import type { Discipline, MissionStatus, UnitStatus } from '../../sim/types';

// All markers are DivIcons styled in CSS, so they stay crisp at any DPI and
// need no image assets. Cached by key so React re-renders don't swap DOM.

const cache = new Map<string, L.DivIcon>();
function cached(key: string, make: () => L.DivIcon): L.DivIcon {
  let icon = cache.get(key);
  if (!icon) cache.set(key, (icon = make()));
  return icon;
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function stationIcon(discipline: Discipline, selected: boolean): L.DivIcon {
  return cached(`st:${discipline}:${selected}`, () =>
    L.divIcon({
      className: '',
      html: `<div class="mk-station mk-${discipline}${selected ? ' is-selected' : ''}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11 12 4l9 7v9h-6v-5H9v5H3z"/></svg></div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    }),
  );
}

export function missionIcon(glyph: string, status: MissionStatus, selected: boolean): L.DivIcon {
  return cached(`m:${glyph}:${status}:${selected}`, () =>
    L.divIcon({
      className: '',
      html: `<div class="mk-mission st-${status}${selected ? ' is-selected' : ''}"><span>${escape(glyph)}</span></div>`,
      iconSize: [36, 44],
      iconAnchor: [18, 42],
    }),
  );
}

/** `offset` shifts the badge in screen pixels (used to fan out units sharing a spot). */
export function unitIcon(specId: string, status: UnitStatus, label: string, offset: [number, number] = [0, 0]): L.DivIcon {
  const spec = getSpec(specId);
  return cached(`u:${specId}:${status}:${label}:${offset.join(',')}`, () =>
    L.divIcon({
      className: '',
      html: `<div class="mk-unit mk-${spec.discipline} us-${status}"><b>${ROLE_BADGE[spec.role]}</b>${escape(label)}</div>`,
      iconSize: [0, 0],
      iconAnchor: [-offset[0], -offset[1]],
    }),
  );
}

export function searchIcon(): L.DivIcon {
  return cached('search', () =>
    L.divIcon({ className: '', html: '<div class="mk-search"></div>', iconSize: [22, 22], iconAnchor: [11, 22] }),
  );
}

/** "Engine 8010" → "8010", "Brush 1" → "B1" style short label for the map badge. */
export function shortCallsign(callsign: string): string {
  const m = callsign.match(/(\d+)\s*$/);
  return m ? m[1]! : callsign.slice(0, 4);
}
