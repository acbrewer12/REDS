import { isOpen } from '../../sim/engine';
import { useStore, type Tab } from '../../store';
import { CallsTab } from './Calls';
import { LogTab } from './Log';
import { StationsTab } from './Stations';

export function Panel() {
  const tab = useStore((s) => s.ui.tab);
  const expanded = useStore((s) => s.ui.sheetExpanded);
  const setTab = useStore((s) => s.setTab);
  const setSheetExpanded = useStore((s) => s.setSheetExpanded);
  const openCalls = useStore((s) => Object.values(s.game.missions).filter(isOpen).length);
  const newCalls = useStore((s) => Object.values(s.game.missions).filter((m) => m.status === 'pending').length);
  const stationCount = useStore((s) => Object.keys(s.game.stations).length);

  const tabs: { id: Tab; label: string; badge?: number; alert?: boolean }[] = [
    { id: 'calls', label: 'Calls', badge: openCalls, alert: newCalls > 0 },
    { id: 'stations', label: 'Stations', badge: stationCount },
    { id: 'log', label: 'CAD log' },
  ];

  return (
    <aside className={`panel${expanded ? ' is-expanded' : ''}`} aria-label="Dispatch console">
      <button
        className="sheet-handle"
        onClick={() => setSheetExpanded(!expanded)}
        aria-label={expanded ? 'Collapse panel' : 'Expand panel'}
      >
        <span />
      </button>
      <nav className="tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`tab${tab === t.id ? ' is-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.badge ? <span className={`badge${t.alert ? ' badge-alert' : ''}`}>{t.badge}</span> : null}
          </button>
        ))}
      </nav>
      <div className="panel-body">
        {tab === 'calls' && <CallsTab />}
        {tab === 'stations' && <StationsTab />}
        {tab === 'log' && <LogTab />}
      </div>
    </aside>
  );
}
