import { getSpec } from '../sim/data/apparatus';
import type { MissionStatus, UnitStatus } from '../sim/types';

export const MISSION_STATUS_LABEL: Record<MissionStatus, string> = {
  pending: 'New',
  dispatched: 'Responding',
  working: 'Working',
  resolved: 'Under control',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/** CAD-style unit status codes. */
export const UNIT_STATUS: Record<UnitStatus, { code: string; label: string }> = {
  in_quarters: { code: 'AQ', label: 'In quarters' },
  dispatched: { code: 'DP', label: 'Turning out' },
  en_route: { code: 'ER', label: 'En route' },
  on_scene: { code: 'OS', label: 'On scene' },
  returning: { code: 'AV', label: 'Returning' },
};

export function MissionChip({ status }: { status: MissionStatus }) {
  return <span className={`chip chip-m-${status}`}>{MISSION_STATUS_LABEL[status]}</span>;
}

export function UnitChip({ status }: { status: UnitStatus }) {
  const s = UNIT_STATUS[status];
  return (
    <span className={`chip chip-u-${status}`} title={s.label}>
      {s.code}
    </span>
  );
}

/** "1,250 gpm · 750 gal · 4 crew" */
export function specSummary(specId: string): string {
  const spec = getSpec(specId);
  const parts: string[] = [];
  if (spec.pumpGpm) parts.push(`${spec.pumpGpm.toLocaleString()} gpm`);
  if (spec.tankGallons) parts.push(`${spec.tankGallons.toLocaleString()} gal`);
  if (spec.aerialFeet) parts.push(`${spec.aerialFeet} ft aerial`);
  parts.push(`${spec.crew} crew`);
  return parts.join(' · ');
}

export function SpecSheet({ specId }: { specId: string }) {
  const spec = getSpec(specId);
  const rows: [string, string | undefined][] = [
    ['Classification', spec.nwcgType],
    ['Standard', spec.standard],
    ['Pump', spec.pumpGpm ? `${spec.pumpGpm.toLocaleString()} gpm @ ${spec.pumpPsi ?? 150} psi` : 'None'],
    ['Tank', spec.tankGallons ? `${spec.tankGallons.toLocaleString()} gal` : '—'],
    ['Foam', spec.foamGallons ? `${spec.foamGallons} gal` : undefined],
    ['Aerial', spec.aerialFeet ? `${spec.aerialFeet} ft` : undefined],
    ['Crew', `${spec.crew} (min ${spec.minCrew})`],
    ['Off-road', spec.offRoad ? '4x4' : 'No'],
  ];
  return (
    <div className="spec-sheet">
      <dl>
        {rows
          .filter((r): r is [string, string] => !!r[1])
          .map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
      </dl>
      <p className="muted small">{spec.description}</p>
    </div>
  );
}
