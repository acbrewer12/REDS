import { useEffect, useRef, useState } from 'react';
import { searchAddress, type GeocodeResult } from '../services/mapServices';
import { SPEEDS, useStore, type BaseLayer } from '../store';
import { formatClock, formatDay, formatNumber } from './format';

export function TopBar() {
  return (
    <header className="topbar">
      <div className="brand" title="Realistic Emergency Dispatch Sim">
        <svg viewBox="0 0 64 64" aria-hidden="true">
          <rect width="64" height="64" rx="14" fill="var(--red)" />
          <path d="M32 10 52 22v20L32 54 12 42V22Z" fill="none" stroke="#fff" strokeWidth="5" />
          <circle cx="32" cy="32" r="7" fill="#fff" />
        </svg>
        <span>REDS</span>
      </div>
      <Clock />
      <SpeedControl />
      <Score />
      <AddressSearch />
      <PlaceStationButton />
      <SettingsMenu />
    </header>
  );
}

function Clock() {
  const now = useStore((s) => s.game.epoch + s.game.clock);
  return (
    <div className="clock" aria-label="Simulation time">
      <span className="clock-time">{formatClock(now)}</span>
      <span className="clock-day">{formatDay(now)}</span>
    </div>
  );
}

function SpeedControl() {
  const speed = useStore((s) => s.speed);
  const setSpeed = useStore((s) => s.setSpeed);
  return (
    <div className="speed" role="group" aria-label="Simulation speed">
      {SPEEDS.map((s) => (
        <button
          key={s}
          className={speed === s ? 'is-active' : ''}
          onClick={() => setSpeed(s)}
          aria-pressed={speed === s}
          title={s === 0 ? 'Pause' : `${s}× speed`}
        >
          {s === 0 ? '❚❚' : `${s}×`}
        </button>
      ))}
    </div>
  );
}

function Score() {
  const credits = useStore((s) => s.game.credits);
  const completed = useStore((s) => s.game.stats.completed);
  return (
    <div className="score" title={`${completed} calls completed`}>
      <span className="score-credits">{formatNumber(credits)}</span>
      <span className="score-label">credits</span>
    </div>
  );
}

function PlaceStationButton() {
  const placing = useStore((s) => s.ui.placing);
  const startPlacing = useStore((s) => s.startPlacing);
  const cancelPlacing = useStore((s) => s.cancelPlacing);
  return placing ? (
    <button className="btn btn-ghost" onClick={cancelPlacing}>
      Cancel placing
    </button>
  ) : (
    <button className="btn btn-primary" onClick={startPlacing}>
      + Station
    </button>
  );
}

function AddressSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flyTo = useStore((s) => s.flyTo);
  const setSearchPin = useStore((s) => s.setSearchPin);
  const draftStationAt = useStore((s) => s.draftStationAt);
  const wrap = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setResults(null);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      setResults(await searchAddress(query));
    } catch {
      setError('Address search is unavailable right now.');
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const choose = (r: GeocodeResult) => {
    setResults(null);
    flyTo(r.position, 17);
    if (useStore.getState().ui.placing) draftStationAt(r.position, r.short);
    else setSearchPin({ position: r.position, label: r.label, short: r.short });
  };

  return (
    <form className="search" onSubmit={submit} ref={wrap} role="search">
      <input
        type="search"
        placeholder="Search a real address…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search address"
      />
      <button className="btn btn-ghost" type="submit" disabled={loading} aria-label="Search">
        {loading ? (
          '…'
        ) : (
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
            <path d="m15.5 15.5 5 5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        )}
      </button>
      {results && (
        <ul className="search-results">
          {error && <li className="muted small pad">{error}</li>}
          {!error && results.length === 0 && <li className="muted small pad">No matches.</li>}
          {results.map((r, i) => (
            <li key={i}>
              <button type="button" onClick={() => choose(r)}>
                <strong>{r.short}</strong>
                <span className="muted small block">{r.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}

function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const resetGame = useStore((s) => s.resetGame);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  return (
    <div className="menu" ref={ref}>
      <button className="btn btn-ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Settings">
        ⚙
      </button>
      {open && (
        <div className="menu-pop">
          <label className="check">
            <input
              type="checkbox"
              checked={settings.roadRouting}
              onChange={(e) => updateSettings({ roadRouting: e.target.checked })}
            />
            <span>
              Road routing
              <span className="muted small block">Drive real roads via OSRM. Off: straight-line estimates.</span>
            </span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.autoClear}
              onChange={(e) => updateSettings({ autoClear: e.target.checked })}
            />
            <span>
              Auto-clear finished calls
              <span className="muted small block">Release units as soon as a call is under control.</span>
            </span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.autoDispatch}
              onChange={(e) => updateSettings({ autoDispatch: e.target.checked })}
            />
            <span>
              Auto-dispatch
              <span className="muted small block">Assign the recommended units to every call automatically.</span>
            </span>
          </label>
          <label className="field">
            <span>Map style</span>
            <select
              value={settings.baseLayer}
              onChange={(e) => updateSettings({ baseLayer: e.target.value as BaseLayer })}
            >
              <option value="streets">Streets (OpenStreetMap)</option>
              <option value="dark">Dark (CARTO)</option>
              <option value="topo">Topographic (OpenTopoMap)</option>
            </select>
          </label>
          <hr />
          <button
            className="btn btn-danger-ghost btn-block"
            onClick={() => {
              if (window.confirm('Start over? This deletes your stations, units and calls.')) {
                resetGame();
                setOpen(false);
              }
            }}
          >
            Reset game
          </button>
        </div>
      )}
    </div>
  );
}
