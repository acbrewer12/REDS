import { useState } from 'react';
import { getSpec } from '../../sim/data/apparatus';
import { getMissionType } from '../../sim/data/missions';
import {
  estimateRoute,
  etaSeconds,
  isAvailable,
  missionUnits,
  turnoutSeconds,
  unitPosition,
} from '../../sim/engine';
import { formatDistance, haversineMeters } from '../../sim/geo';
import { describeShortfall, matchRequirements, rankCandidates, recommendUnits } from '../../sim/requirements';
import type { GameState, Mission, Unit } from '../../sim/types';
import { useStore } from '../../store';
import { MissionChip, specSummary, UNIT_STATUS, UnitChip } from '../common';
import { formatClock, formatDuration } from '../format';

const STATUS_ORDER: Record<Mission['status'], number> = {
  resolved: 0,
  pending: 1,
  dispatched: 2,
  working: 3,
  completed: 4,
  cancelled: 5,
};

export function CallsTab() {
  const selectedId = useStore((s) => s.ui.selectedMissionId);
  const exists = useStore((s) => !!(selectedId && s.game.missions[selectedId]));
  return exists ? <MissionDetail key={selectedId} missionId={selectedId!} /> : <MissionList />;
}

function MissionList() {
  const game = useStore((s) => s.game);
  const selectMission = useStore((s) => s.selectMission);
  const flyTo = useStore((s) => s.flyTo);
  const startPlacing = useStore((s) => s.startPlacing);
  const missions = Object.values(game.missions).sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.createdAt - b.createdAt,
  );

  if (Object.keys(game.stations).length === 0) {
    return (
      <div className="empty">
        <p>No stations yet. Calls are generated inside each station’s first-due area.</p>
        <button className="btn btn-primary" onClick={startPlacing}>
          Place your first station
        </button>
      </div>
    );
  }
  if (missions.length === 0) {
    const hasUnits = Object.keys(game.units).length > 0;
    return (
      <div className="empty">
        {hasUnits ? (
          <>
            <p>No active calls. The next one will drop in shortly.</p>
            <p className="muted small">Tip: speed up the clock in the top bar.</p>
          </>
        ) : (
          <p>Add apparatus to your station — calls only come in for incidents your fleet can handle.</p>
        )}
      </div>
    );
  }
  return (
    <ul className="list">
      {missions.map((m) => {
        const type = getMissionType(m.typeId);
        const shortfall =
          m.status === 'pending' || m.status === 'dispatched'
            ? describeShortfall(matchRequirements(type, missionUnits(game, m)))
            : [];
        return (
          <li key={m.id}>
            <button
              className={`list-item call-item st-${m.status}`}
              onClick={() => {
                selectMission(m.id);
                flyTo(m.position, 15);
              }}
            >
              <span className="call-icon" aria-hidden="true">
                {type.icon}
              </span>
              <span className="grow">
                <span className="row between">
                  <strong>{type.name}</strong>
                  <MissionChip status={m.status} />
                </span>
                <span className="muted small block">{m.address}</span>
                <span className="small block">
                  <span className="muted">
                    #{m.incidentNumber} · {formatDuration((game.clock - m.createdAt) / 1000)} ago
                  </span>
                  {shortfall.length > 0 && <span className="warn"> · needs {shortfall.join(', ')}</span>}
                  {m.status === 'working' && (
                    <span className="ok"> · {Math.floor((m.workDoneSec / m.workRequiredSec) * 100)}%</span>
                  )}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

interface Candidate {
  unit: Unit;
  etaSec: number;
  distanceM: number;
}

/** Available units, closest (by estimated ETA) first, then best-suited. */
function availableCandidates(game: GameState, mission: Mission): Candidate[] {
  const candidates = Object.values(game.units)
    .filter(isAvailable)
    .map((unit) => {
      const from = unitPosition(unit, game.clock);
      const route = estimateRoute(from, mission.position);
      return { unit, etaSec: etaSeconds(game, unit, route), distanceM: haversineMeters(from, mission.position) };
    });
  return rankCandidates(getMissionType(mission.typeId), candidates);
}

function MissionDetail({ missionId }: { missionId: string }) {
  const game = useStore((s) => s.game);
  const busy = useStore((s) => s.ui.busy);
  const selectMission = useStore((s) => s.selectMission);
  const dispatch = useStore((s) => s.dispatch);
  const releaseUnit = useStore((s) => s.releaseUnit);
  const closeMission = useStore((s) => s.closeMission);
  const flyTo = useStore((s) => s.flyTo);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);

  const mission = game.missions[missionId]!;
  const type = getMissionType(mission.typeId);
  const assigned = missionUnits(game, mission);
  const onScene = assigned.filter((u) => u.status === 'on_scene');
  const sceneResult = matchRequirements(type, onScene);
  const assignedResult = matchRequirements(type, assigned);
  const candidates = availableCandidates(game, mission);
  const firstDue = game.stations[mission.stationId];
  const canDispatch = mission.status !== 'resolved';

  const rows = type.units.map((r) => ({
    label: r.label,
    need: r.count,
    onScene: sceneResult.slots.filter((s) => s.label === r.label && s.unitId).length,
    assigned: assignedResult.slots.filter((s) => s.label === r.label && s.unitId).length,
  }));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const recommend = () => {
    const pick = recommendUnits(
      type,
      assigned,
      candidates.map((c) => c.unit),
    );
    if (pick === null) {
      setNotice('Not enough available units to cover this call — pick manually or wait for units to clear.');
      setSelected(new Set());
    } else if (pick.length === 0) {
      setNotice('Assigned units already cover the requirement.');
    } else {
      setNotice(null);
      setSelected(new Set(pick.map((u) => u.id)));
    }
  };

  const doDispatch = async () => {
    const ids = [...selected];
    setSelected(new Set());
    setNotice(null);
    await dispatch(mission.id, ids);
  };

  const progress = mission.workRequiredSec ? mission.workDoneSec / mission.workRequiredSec : 0;

  return (
    <div className="detail">
      <div className="detail-head">
        <button className="btn btn-ghost btn-sm" onClick={() => selectMission(null)} aria-label="Back to call list">
          ← Calls
        </button>
        <span className="muted small">#{mission.incidentNumber}</span>
      </div>

      <div className="call-title">
        <span className="call-icon big" aria-hidden="true">
          {type.icon}
        </span>
        <div className="grow">
          <h2>{type.name}</h2>
          <button className="link" onClick={() => flyTo(mission.position, 16)}>
            {mission.address}
          </button>
        </div>
        <MissionChip status={mission.status} />
      </div>

      <p className="narrative">“{mission.narrative}”</p>
      <p className="muted small">
        Received {formatClock(game.epoch + mission.createdAt)} ({formatDuration((game.clock - mission.createdAt) / 1000)} ago)
        {firstDue && <> · {firstDue.name} first-due</>}
      </p>

      <section>
        <h3>Requirements</h3>
        <table className="req-table">
          <thead>
            <tr>
              <th></th>
              <th>On scene</th>
              <th>Assigned</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td>
                  {r.need}× {r.label}
                </td>
                <td className={r.onScene >= r.need ? 'ok' : ''}>
                  {r.onScene}/{r.need}
                </td>
                <td className={r.assigned >= r.need ? 'ok' : 'warn'}>
                  {r.assigned}/{r.need}
                </td>
              </tr>
            ))}
            {sceneResult.water.need > 0 && (
              <tr>
                <td>Water on scene</td>
                <td className={sceneResult.water.have >= sceneResult.water.need ? 'ok' : ''}>
                  {sceneResult.water.have.toLocaleString()} / {sceneResult.water.need.toLocaleString()} gal
                </td>
                <td className={assignedResult.water.have >= assignedResult.water.need ? 'ok' : 'warn'}>
                  {assignedResult.water.have.toLocaleString()} gal
                </td>
              </tr>
            )}
            {sceneResult.personnel.need > 0 && (
              <tr>
                <td>Personnel</td>
                <td className={sceneResult.personnel.have >= sceneResult.personnel.need ? 'ok' : ''}>
                  {sceneResult.personnel.have} / {sceneResult.personnel.need}
                </td>
                <td className={assignedResult.personnel.have >= assignedResult.personnel.need ? 'ok' : 'warn'}>
                  {assignedResult.personnel.have}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {(mission.status === 'working' || mission.status === 'resolved') && (
        <section>
          <div className="row between small">
            <span>{mission.status === 'resolved' ? 'Under control' : 'Working the incident'}</span>
            <span className="muted">
              {mission.status === 'resolved'
                ? '100%'
                : `${Math.floor(progress * 100)}% · ~${formatDuration(mission.workRequiredSec - mission.workDoneSec)} left`}
            </span>
          </div>
          <div className="progress">
            <div style={{ width: `${progress * 100}%` }} />
          </div>
        </section>
      )}

      {mission.status === 'resolved' && (
        <button
          className="btn btn-success btn-block"
          disabled={!!busy[mission.id]}
          onClick={() => closeMission(mission.id, 'completed')}
        >
          ✓ Mark complete — release units (+{type.credits.toLocaleString()} credits)
        </button>
      )}

      <section>
        <h3>Assigned units ({assigned.length})</h3>
        {assigned.length === 0 ? (
          <p className="muted small">Nothing assigned yet.</p>
        ) : (
          <ul className="unit-list">
            {assigned.map((u) => (
              <li key={u.id} className="unit-row">
                <UnitChip status={u.status} />
                <span className="grow">
                  <strong>{u.callsign}</strong>
                  <span className="muted small block">{getSpec(u.specId).name}</span>
                </span>
                <span className="small muted">
                  {u.trip && (u.status === 'en_route' || u.status === 'dispatched')
                    ? `ETA ${formatDuration((u.trip.arriveAt - game.clock) / 1000)}`
                    : UNIT_STATUS[u.status].label}
                </span>
                {mission.status !== 'resolved' && (
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={!!busy[u.id]}
                    onClick={() => releaseUnit(u.id)}
                    title="Cancel this unit and send it back to quarters"
                  >
                    Release
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canDispatch && (
        <section>
          <div className="row between">
            <h3>Available units</h3>
            <button className="btn btn-ghost btn-sm" onClick={recommend} disabled={candidates.length === 0}>
              Select recommended
            </button>
          </div>
          {notice && <p className="notice small">{notice}</p>}
          {candidates.length === 0 ? (
            <p className="muted small">No units available. Units on another call can’t be assigned until they clear.</p>
          ) : (
            <ul className="unit-list">
              {candidates.map(({ unit, etaSec, distanceM }) => {
                const station = game.stations[unit.stationId];
                const turnout =
                  unit.status === 'in_quarters' && station
                    ? turnoutSeconds(station.staffing, getSpec(unit.specId).discipline)
                    : 0;
                return (
                  <li key={unit.id}>
                    <label className={`unit-row selectable${selected.has(unit.id) ? ' is-selected' : ''}`}>
                      <input
                        type="checkbox"
                        checked={selected.has(unit.id)}
                        disabled={!!busy[unit.id]}
                        onChange={() => toggle(unit.id)}
                      />
                      <UnitChip status={unit.status} />
                      <span className="grow">
                        <strong>{unit.callsign}</strong>
                        <span className="muted small block">{specSummary(unit.specId)}</span>
                      </span>
                      <span className="small right">
                        ~{formatDuration(etaSec)}
                        <span className="muted block">
                          {formatDistance(distanceM)}
                          {turnout > 0 && ` · ${formatDuration(turnout)} turnout`}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          <button
            className="btn btn-primary btn-block sticky-action"
            disabled={selected.size === 0}
            onClick={doDispatch}
          >
            Dispatch {selected.size > 0 ? `${selected.size} unit${selected.size > 1 ? 's' : ''}` : ''}
          </button>
        </section>
      )}

      <div className="row end">
        <button
          className="btn btn-danger-ghost btn-sm"
          disabled={!!busy[mission.id]}
          onClick={() => {
            if (window.confirm('Cancel this call? Assigned units return to quarters and no credits are earned.'))
              void closeMission(mission.id, 'cancelled');
          }}
        >
          Cancel call
        </button>
      </div>
    </div>
  );
}
