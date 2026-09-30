export type MeterTone = 'accent' | 'gold';

const base = 'h-2 flex-1 rounded-round';

const filledTones: Readonly<Record<MeterTone, string>> = {
  accent: 'bg-accent',
  gold: 'bg-gold',
};

/** One segment of a meter: filled in the tone, or an empty track. */
export const segmentClass = (filled: boolean, tone: MeterTone): string =>
  `${base} ${filled ? filledTones[tone] : 'bg-surface-overlay'}`;
