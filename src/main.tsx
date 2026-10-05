import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'leaflet/dist/leaflet.css';
import './styles.css';
import { App } from './App';
import { useStore } from './store';

// Dev-only handle for debugging and browser tests: window.__reds.getState()
if (import.meta.env.DEV) (window as unknown as { __reds: typeof useStore }).__reds = useStore;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
