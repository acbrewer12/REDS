import { useState } from 'react';
import { getSpec } from '../sim/data/apparatus';
import { FLEET_PRESET_REGIONS, FLEET_PRESETS, FLEET_PRESETS_BY_ID } from '../sim/data/presets';
import { nearestDispatchCenter } from '../sim/engine';
import type { Discipline, StaffingModel } from '../sim/types';
import { useStore } from '../store';
import { formatLatLng } from '../services/mapServices';
import { DISCIPLINE_LABEL, STAFFING_LABEL } from './panels/Stations';

export function NewStationDialog() {
  const draft = useStore((s) => s.ui.draftStation);
  // Remount the form for each new draft location so defaults reset.
  return draft ? <Form key={`${draft.position.lat},${draft.position.lng}`} /> : null;
}

function Form() {
  const draft = useStore((s) => s.ui.draftStation)!;
  const confirmStation = useStore((s) => s.confirmStation);
  const cancelPlacing = useStore((s) => s.cancelPlacing);
  const game = useStore((s) => s.game);
  const dispatchCenters = game.dispatchCenters;
  const hasStations = Object.keys(game.stations).length > 0;

  const [presetId, setPresetId] = useState(hasStations ? 'rural-fire-basic' : 'dent-county-fpd');
  const preset = FLEET_PRESETS_BY_ID[presetId]!;
  const [name, setName] = useState(preset.stationName);
  const [discipline, setDiscipline] = useState<Discipline>(preset.discipline);
  const [staffing, setStaffing] = useState<StaffingModel>(preset.staffing);
  const [radius, setRadius] = useState(preset.responseRadiusKm);
  const [address, setAddress] = useState<string | null>(null); // null = use looked-up address

  // A nearby existing center (within mutual-aid range) is suggested to
  // join by default; a distant placement (e.g. a second region far away)
  // defaults to starting its own, independent dispatch center.
  const suggestion = nearestDispatchCenter(game, draft.position);
  const [centerChoice, setCenterChoice] = useState<string>(suggestion ? suggestion.centerId : '__new__');
  const [newCenterName, setNewCenterName] = useState('');

  const choosePreset = (id: string) => {
    const p = FLEET_PRESETS_BY_ID[id]!;
    setPresetId(id);
    setName(p.stationName);
    setDiscipline(p.discipline);
    setStaffing(p.staffing);
    setRadius(p.responseRadiusKm);
  };

  const shownAddress = address ?? draft.address;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="new-station-title">
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault();
          confirmStation({
            presetId,
            name: name.trim() || preset.stationName,
            discipline,
            staffing,
            responseRadiusKm: radius,
            address: draft.resolving && address === null ? formatLatLng(draft.position) : shownAddress,
            centerId: centerChoice === '__new__' ? null : centerChoice,
            newCenterName,
          });
        }}
      >
        <h2 id="new-station-title">New station</h2>
        <label className="field">
          <span>Address</span>
          <input value={shownAddress} onChange={(e) => setAddress(e.target.value)} disabled={draft.resolving && address === null} />
          <span className="muted small">{formatLatLng(draft.position)}</span>
        </label>

        <label className="field">
          <span>Starting fleet</span>
          <select value={presetId} onChange={(e) => choosePreset(e.target.value)}>
            {FLEET_PRESET_REGIONS.map((region) => (
              <optgroup key={region} label={region}>
                {FLEET_PRESETS.filter((p) => p.region === region).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        {preset.units.length > 0 && (
          <ul className="preset-units">
            {preset.units.map((u) => (
              <li key={u.callsign}>
                <strong>{u.callsign}</strong> <span className="muted">{getSpec(u.specId).name}</span>
              </li>
            ))}
          </ul>
        )}
        {preset.note && <p className="notice small">{preset.note}</p>}

        <label className="field">
          <span>Station name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <div className="field-row">
          <label className="field">
            <span>Type</span>
            <select value={discipline} onChange={(e) => setDiscipline(e.target.value as Discipline)}>
              {(['fire', 'police', 'ems'] as Discipline[]).map((d) => (
                <option key={d} value={d}>
                  {DISCIPLINE_LABEL[d]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Staffing</span>
            <select value={staffing} onChange={(e) => setStaffing(e.target.value as StaffingModel)}>
              {(Object.keys(STAFFING_LABEL) as StaffingModel[]).map((k) => (
                <option key={k} value={k}>
                  {STAFFING_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span>First-due radius: {radius} km</span>
          <input type="range" min={2} max={30} value={radius} onChange={(e) => setRadius(Number(e.target.value))} />
        </label>

        <label className="field">
          <span>Dispatch center</span>
          <select value={centerChoice} onChange={(e) => setCenterChoice(e.target.value)}>
            {Object.keys(dispatchCenters).length > 0 && (
              <optgroup label="Join existing — shares calls & units">
                {Object.values(dispatchCenters).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {suggestion?.centerId === c.id ? ` (${suggestion.distanceKm.toFixed(0)} km away)` : ''}
                  </option>
                ))}
              </optgroup>
            )}
            <option value="__new__">+ New dispatch center — independent region</option>
          </select>
          <span className="muted small">
            {centerChoice === '__new__'
              ? 'Calls and units here stay separate from every other dispatch center — use this for a far-away region (e.g. Alaska).'
              : 'Mutual aid: this station shares its call pool and unit pool with every other station in that center.'}
          </span>
        </label>
        {centerChoice === '__new__' && (
          <label className="field">
            <span>New center name</span>
            <input
              value={newCenterName}
              onChange={(e) => setNewCenterName(e.target.value)}
              placeholder={`${name.trim() || preset.stationName} Dispatch`}
            />
          </label>
        )}

        <div className="row end gap">
          <button type="button" className="btn btn-ghost" onClick={cancelPlacing}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            Place in service
          </button>
        </div>
      </form>
    </div>
  );
}
