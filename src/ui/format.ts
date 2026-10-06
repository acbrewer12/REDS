/** CAD-style 24h clock: "14:02:11". */
export function formatClock(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString('en-US', { hour12: false });
}

export function formatDay(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

/** "45 s", "6 min", "1 h 05 min". */
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s} s`;
  const min = Math.round(s / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

export const formatNumber = (n: number) => n.toLocaleString('en-US');

/** "42 mph" */
export const formatSpeed = (mph: number) => `${Math.round(mph)} mph`;
