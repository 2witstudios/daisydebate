import type { DebateMode, Side, Visibility, WatchDebate } from './debate';

export const modeLabel = (mode: DebateMode): string =>
  mode === 'ranked' ? 'Ranked' : 'Casual';

/** Ranked always runs the standard rules; only casual may customize. */
export const rulesLabel = (debate: Pick<WatchDebate, 'customRules'>): string =>
  debate.customRules ? 'Custom rules' : 'Standard rules';

export const sideLabel = (side: Side): string =>
  side === 'aff' ? 'Aff' : 'Neg';

const visibilityLabels: Readonly<Record<Visibility, string>> = {
  public: 'Public',
  unlisted: 'Unlisted',
  private: 'Private',
};

export const visibilityLabel = (visibility: Visibility): string =>
  visibilityLabels[visibility];

/** "03:48": a running clock, minutes padded to two digits. */
export function clockLabel(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = String(Math.floor(whole / 60)).padStart(2, '0');
  const rest = String(whole % 60).padStart(2, '0');
  return `${minutes}:${rest}`;
}

/** "5:00": a length, minutes unpadded. */
export function durationLabel(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
