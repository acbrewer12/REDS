import { useEffect } from 'react';
import { useStore } from '../store';

/** Drive the simulation at ~10 Hz of real time. */
export function useGameLoop() {
  useEffect(() => {
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      useStore.getState().advance(now - last);
      last = now;
    }, 100);
    return () => clearInterval(id);
  }, []);
}
