import { useStore } from '../../store';
import { formatClock } from '../format';

export function LogTab() {
  const log = useStore((s) => s.game.log);
  const epoch = useStore((s) => s.game.epoch);
  const missions = useStore((s) => s.game.missions);
  const selectMission = useStore((s) => s.selectMission);
  if (log.length === 0) return <div className="empty muted">The CAD log is empty.</div>;
  return (
    <ol className="log">
      {[...log].reverse().map((e) => {
        const linked = e.missionId && missions[e.missionId];
        return (
          <li key={e.id} className={`log-${e.kind}`}>
            <time>{formatClock(epoch + e.t)}</time>
            {linked ? (
              <button className="link" onClick={() => selectMission(e.missionId!)}>
                {e.text}
              </button>
            ) : (
              <span>{e.text}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
