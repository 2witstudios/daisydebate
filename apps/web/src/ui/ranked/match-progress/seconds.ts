/** Elapsed search time as minutes and two-digit seconds. */
export const formatElapsed = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** Whole seconds left of a countdown; never below zero. */
export const secondsLeft = (total: number, elapsed: number): number =>
  Math.max(0, total - elapsed);

// Tenths are enough for a six-pixel bar; each class is written out so the
// stylesheet scan finds it.
const widths = [
  'w-0',
  'w-1/10',
  'w-2/10',
  'w-3/10',
  'w-4/10',
  'w-5/10',
  'w-6/10',
  'w-7/10',
  'w-8/10',
  'w-9/10',
  'w-full',
] as const;

/** The bar's width class for the seconds left, rounded up to a tenth. */
export function barWidthClass(left: number, total: number): string {
  const tenths = total <= 0 ? 0 : Math.ceil((10 * left) / total);
  return widths[Math.min(10, Math.max(0, tenths))] as string;
}
