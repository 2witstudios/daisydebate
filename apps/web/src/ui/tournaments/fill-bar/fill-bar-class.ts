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

export const fillTrackClass = (): string =>
  'block h-1 w-full overflow-hidden rounded-round bg-surface-overlay';
export const fillBarClass = (percent: number): string =>
  `block h-full rounded-round bg-accent ${fillWidthClass(percent)}`;
