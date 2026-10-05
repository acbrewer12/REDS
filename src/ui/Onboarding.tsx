import { useStore } from '../store';
import { DEFAULT_CENTER } from './map/MapView';

/** First-run card, and the "click to place" banner while placing. */
export function Onboarding() {
  const hasStations = useStore((s) => Object.keys(s.game.stations).length > 0);
  const placing = useStore((s) => s.ui.placing);
  const draft = useStore((s) => s.ui.draftStation);
  const startPlacing = useStore((s) => s.startPlacing);
  const cancelPlacing = useStore((s) => s.cancelPlacing);
  const flyTo = useStore((s) => s.flyTo);

  if (placing) {
    return (
      <div className="banner" role="status">
        <span>
          <strong>Click the map</strong> where the station sits, or search its street address above.
        </span>
        <button className="btn btn-ghost btn-sm" onClick={cancelPlacing}>
          Cancel
        </button>
      </div>
    );
  }
  if (hasStations || draft) return null;

  return (
    <div className="welcome" role="dialog" aria-labelledby="welcome-title">
      <h2 id="welcome-title">Realistic Emergency Dispatch Sim</h2>
      <p>
        Build your department on the real map. Put a station at its actual address, give it real apparatus, and dispatch
        units to calls in its first-due area.
      </p>
      <ol>
        <li>Place a station (search an address or click the map)</li>
        <li>Pick a starting fleet</li>
        <li>Select incoming calls, dispatch units, and clear the call when it’s under control</li>
      </ol>
      <div className="row gap wrap">
        <button
          className="btn btn-primary"
          onClick={() => {
            flyTo(DEFAULT_CENTER, 15);
            startPlacing();
          }}
        >
          Start in Salem, MO
        </button>
        <button className="btn btn-ghost" onClick={startPlacing}>
          Place somewhere else
        </button>
      </div>
    </div>
  );
}
