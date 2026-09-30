// Twelfths are the finest token-locked widths; literal classes keep the
// scanner able to see every one.
const widths = [
  'w-0',
  'w-1/12',
  'w-2/12',
  'w-3/12',
  'w-4/12',
  'w-5/12',
  'w-6/12',
  'w-7/12',
  'w-8/12',
  'w-9/12',
  'w-10/12',
  'w-11/12',
  'w-full',
] as const;

/** Width class for a 0 to 100 fill, rounded to the nearest twelfth. */
export const fillWidthClass = (percent: number): string =>
  widths[Math.round((Math.min(100, Math.max(0, percent)) * 12) / 100)] ?? 'w-0';

export type FillTone = 'default' | 'stage';

const tracks: Readonly<Record<FillTone, string>> = {
  default: 'bg-surface-overlay',
  stage: 'border border-stage-ink-muted bg-transparent',
};
const bars: Readonly<Record<FillTone, string>> = {
  default: 'bg-accent',
  stage: 'bg-stage-accent',
};

export const fillTrackClass = (tone: FillTone): string =>
  `block h-1 w-full overflow-hidden rounded-round ${tracks[tone]}`;
export const fillBarClass = (percent: number, tone: FillTone): string =>
  `block h-full rounded-round ${bars[tone]} ${fillWidthClass(percent)}`;
