export const modeLabel = (mode: 'ranked' | 'casual'): string =>
  mode === 'ranked' ? 'Ranked' : 'Casual';

/** "03:48": a running clock, minutes padded to two digits. */
export function clockLabel(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = String(Math.floor(whole / 60)).padStart(2, '0');
  const rest = String(whole % 60).padStart(2, '0');
  return `${minutes}:${rest}`;
}
