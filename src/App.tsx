import { MapView } from './ui/map/MapView';
import { NewStationDialog } from './ui/NewStationDialog';
import { Onboarding } from './ui/Onboarding';
import { Panel } from './ui/panels/Panel';
import { TopBar } from './ui/TopBar';
import { useGameLoop } from './ui/useGameLoop';

export function App() {
  useGameLoop();
  return (
    <div className="app">
      <TopBar />
      <main className="main">
        <MapView />
        <Onboarding />
        <Panel />
      </main>
      <NewStationDialog />
    </div>
  );
}
