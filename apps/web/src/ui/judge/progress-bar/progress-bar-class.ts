export type ProgressTone = 'gold' | 'accent';

/**
 * The fill's width in twentieths. Tailwind only emits classes it can read
 * as literals, and a style attribute is not allowed, so each step is spelled
 * out.
 */
const widths = [
  'w-0',
  'w-1/20',
  'w-1/10',
  'w-3/20',
  'w-1/5',
  'w-1/4',
  'w-3/10',
  'w-7/20',
  'w-2/5',
  'w-9/20',
  'w-1/2',
  'w-11/20',
  'w-3/5',
  'w-13/20',
  'w-7/10',
  'w-3/4',
  'w-4/5',
  'w-17/20',
  'w-9/10',
  'w-19/20',
  'w-full',
] as const;

const tones: Readonly<Record<ProgressTone, string>> = {
  gold: 'bg-gold',
  accent: 'bg-accent',
};

export const progressTrackClass =
  'h-2 overflow-hidden rounded-round bg-surface-overlay';

/** Rounds a percentage to the nearest twentieth and clamps it to 0-100. */
export const progressFillClass = (
  percent: number,
  tone: ProgressTone,
): string => {
  const step = Math.min(20, Math.max(0, Math.round(percent / 5)));
  return `h-full ${widths[step]} ${tones[tone]}`;
};
