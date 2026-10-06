import { useState } from 'react';
import { APPARATUS, getSpec } from '../../sim/data/apparatus';
import { TURNOUT_SECONDS } from '../../sim/data/presets';
import { suggestCallsign } from '../../sim/engine';
import type { Discipline, StaffingModel, Station, Unit } from '../../sim/types';
import { useStore } from '../../store';
import { SpecSheet, specSummary, UNIT_STATUS, UnitChip } from '../common';
import { formatDuration } from '../format';

export const DISCIPLINE_LABEL: Record<Discipline, string> = { fire: 'Fire', police: 'Police', ems: 'EMS' };
export const STAFFING_LABEL: Record<StaffingModel, string> = {
  career: 'Career (staffed 24/7)',
  combination: 'Combination',
  volunteer: 'Volunteer (respond from home)',
};

export function StationsTab() {
  const selectedId = useStore((s) => s.ui.selectedStationId);
  const exists = useStore((s) => !!(selectedId && s.game.stations[selectedId]));
  return exists ? <StationDetail key={selectedId} stationId={selectedId!} /> : <StationList />;
}

function StationList() {
  const stations = useStore((s) => s.game.stations);
  const units = useStore((s) => s.game.units);
  const dispatchCenters = useStore((s) => s.game.dispatchCenters);
  const selectStation = useStore((s) => s.selectStation);
  const startPlacing = useStore((s) => s.startPlacing);
  const flyTo = useStore((s) => s.flyTo);
  const list = Object.values(stations);
  const centerCount = Object.keys(dispatchCenters).length;
  return (
    <div>
      {list.length === 0 ? (
        <div className="empty">
          <p>Search a real address or click the map to place a station.</p>
        </div>
      ) : (
        <ul className="list">
          {list.map((st) => {
            const own = Object.values(units).filter((u) => u.stationId === st.id);
            const home = own.filter((u) => u.status === 'in_quarters').length;
            return (
              <li key={st.id}>
                <button
                  className="list-item"
                  onClick={() => {
                    selectStation(st.id);
                    flyTo(st.position, 14);
                  }}
                >
                  <span className={`station-dot mk-${st.discipline}`} aria-hidden="true" />
                  <span className="grow">
                    <strong>{st.name}</strong>
                    <span className="muted small block">
                      {st.address}
                      {centerCount > 1 && <> · {dispatchCenters[st.centerId]?.name ?? 'Dispatch center'}</>}
                    </span>
                  </span>
                  <span className="small right">
                    {home}/{own.length}
                    <span className="muted block">in quarters</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="pad">
        <button className="btn btn-primary btn-block" onClick={startPlacing}>
          + Place a station
        </button>
      </div>
    </div>
  );
}

function StationDetail({ stationId }: { stationId: string }) {
  const game = useStore((s) => s.game);
  const selectStation = useStore((s) => s.selectStation);
  const editStation = useStore((s) => s.editStation);
  const deleteStation = useStore((s) => s.deleteStation);
  const flyTo = useStore((s) => s.flyTo);
  const station = game.stations[stationId]!;
  const units = Object.values(game.units).filter((u) => u.stationId === stationId);
  const allHome = units.every((u) => u.status === 'in_quarters');
  const center = game.dispatchCenters[station.centerId];
  const centerMates = Object.values(game.stations).filter(
    (st) => st.centerId === station.centerId && st.id !== station.id,
  ).length;

  return (
    <div className="detail">
      <div className="detail-head">
        <button className="btn btn-ghost btn-sm" onClick={() => selectStation(null)}>
          ← Stations
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => flyTo(station.position, 15)}>
          Zoom to
        </button>
      </div>

      <label className="field">
        <span>Station name</span>
        <input value={station.name} onChange={(e) => editStation(station.id, { name: e.target.value })} />
      </label>
      <label className="field">
        <span>Address</span>
        <input value={station.address} onChange={(e) => editStation(station.id, { address: e.target.value })} />
      </label>
      <div className="field-row">
        <label className="field">
          <span>Staffing</span>
          <select
            value={station.staffing}
            onChange={(e) => editStation(station.id, { staffing: e.target.value as StaffingModel })}
          >
            {(Object.keys(STAFFING_LABEL) as StaffingModel[]).map((k) => (
              <option key={k} value={k}>
                {STAFFING_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>First-due radius: {station.responseRadiusKm} km</span>
          <input
            type="range"
            min={2}
            max={30}
            value={station.responseRadiusKm}
            onChange={(e) => editStation(station.id, { responseRadiusKm: Number(e.target.value) })}
          />
        </label>
      </div>
      <p className="muted small">
        {DISCIPLINE_LABEL[station.discipline]} station
        {station.discipline !== 'police' && <> · turnout {formatDuration(TURNOUT_SECONDS[station.staffing])}</>}
        {center && (
          <>
            {' '}
            · {center.name}
            {centerMates > 0 ? ` (shares calls & units with ${centerMates} other station${centerMates > 1 ? 's' : ''})` : ' (own dispatch center)'}
          </>
        )}
      </p>

      <section>
        <h3>Apparatus ({units.length})</h3>
        {units.length === 0 ? (
          <p className="muted small">No units yet — add one below.</p>
        ) : (
          <ul className="unit-list">
            {units.map((u) => (
              <UnitRow key={u.id} unit={u} />
            ))}
          </ul>
        )}
      </section>

      <AddUnit station={station} />

      <div className="row end">
        <button
          className="btn btn-danger-ghost btn-sm"
          disabled={!allHome}
          title={allHome ? undefined : 'All units must be in quarters'}
          onClick={() => {
            if (window.confirm(`Remove ${station.name} and its ${units.length} units?`)) deleteStation(station.id);
          }}
        >
          Remove station
        </button>
      </div>
    </div>
  );
}

function UnitRow({ unit }: { unit: Unit }) {
  const renameUnit = useStore((s) => s.renameUnit);
  const removeUnit = useStore((s) => s.removeUnit);
  const selectMission = useStore((s) => s.selectMission);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(unit.callsign);
  const [open, setOpen] = useState(false);
  const spec = getSpec(unit.specId);

  return (
    <li className="unit-block">
      <div className="unit-row">
        <UnitChip status={unit.status} />
        <span className="grow">
          {editing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                renameUnit(unit.id, name);
                setEditing(false);
              }}
            >
              <input
                autoFocus
                value={name}
                aria-label="Callsign"
                onChange={(e) => setName(e.target.value)}
                onBlur={() => {
                  renameUnit(unit.id, name);
                  setEditing(false);
                }}
              />
            </form>
          ) : (
            <button className="link strong" onClick={() => setEditing(true)} title="Rename">
              {unit.callsign}
            </button>
          )}
          <span className="muted small block">
            {spec.name} · {specSummary(unit.specId)}
          </span>
        </span>
        {unit.missionId ? (
          <button className="btn btn-ghost btn-sm" onClick={() => selectMission(unit.missionId)}>
            {UNIT_STATUS[unit.status].label}
          </button>
        ) : (
          <button className="btn btn-ghost btn-sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            Specs
          </button>
        )}
      </div>
      {open && (
        <div className="unit-specs">
          <SpecSheet specId={unit.specId} />
          <button
            className="btn btn-danger-ghost btn-sm"
            disabled={unit.status !== 'in_quarters'}
            onClick={() => removeUnit(unit.id)}
          >
            Take out of service
          </button>
        </div>
      )}
    </li>
  );
}

function AddUnit({ station }: { station: Station }) {
  const game = useStore((s) => s.game);
  const addUnitToStation = useStore((s) => s.addUnitToStation);
  const disciplines: Discipline[] = station.discipline === 'police' ? ['police'] : ['fire', 'ems'];
  const options = APPARATUS.filter((a) => disciplines.includes(a.discipline));
  const [specId, setSpecId] = useState(options[0]?.id ?? '');
  const [callsign, setCallsign] = useState(() => (specId ? suggestCallsign(game, specId) : ''));

  if (!specId) return null;
  return (
    <section className="add-unit">
      <h3>Add apparatus</h3>
      <div className="field-row">
        <label className="field grow">
          <span>Model</span>
          <select
            value={specId}
            onChange={(e) => {
              setSpecId(e.target.value);
              setCallsign(suggestCallsign(game, e.target.value));
            }}
          >
            {disciplines.map((d) => (
              <optgroup key={d} label={DISCIPLINE_LABEL[d]}>
                {options
                  .filter((a) => a.discipline === d)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Callsign</span>
          <input value={callsign} onChange={(e) => setCallsign(e.target.value)} />
        </label>
      </div>
      <SpecSheet specId={specId} />
      <button
        className="btn btn-primary btn-block"
        disabled={!callsign.trim()}
        onClick={() => {
          addUnitToStation(station.id, specId, callsign.trim());
          setCallsign(suggestCallsign(useStore.getState().game, specId));
        }}
      >
        Add {callsign.trim() || 'unit'}
      </button>
    </section>
  );
}
