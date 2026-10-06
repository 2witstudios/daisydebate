import type { Side } from '../../features/debates/turns';

/** One grid for the score sheet's header, rows and total; the phone stacks the category over the two sides. */
export const ballotGridClass =
  'grid grid-cols-12 items-center gap-x-6 max-narrow:grid-cols-2 max-narrow:gap-x-4';

/** The category column, full width on a phone. */
export const ballotLabelCellClass = 'col-span-6 min-w-0 max-narrow:col-span-2';

/** One side's column. */
export const ballotSideCellClass = 'col-span-3 min-w-0 max-narrow:col-span-1';

/** A section of the ballot: a tone-separated card with a display heading. */
export const ballotSectionClass =
  'flex flex-col gap-4 rounded-xl bg-surface p-6 shadow-1 max-compact:p-4';

export const ballotHeadingClass =
  'font-display text-xl leading-tight font-bold text-ink';

/** The quiet uppercase label of a table head or group row. */
export const ballotEyebrowClass =
  'text-2xs font-bold tracking-wider text-ink-faint uppercase';

const sideTextClasses: Readonly<Record<Side, string>> = {
  affirmative: 'text-accent',
  negative: 'text-hue-clay',
};

/** Aff reads in the accent, Neg in clay, as everywhere a side is named. */
export const sideTextClass = (side: Side): string => sideTextClasses[side];

const sideControlClasses: Readonly<Record<Side, string>> = {
  affirmative: 'accent-accent',
  negative: 'accent-hue-clay',
};

/** A native control filled in its side's colour. */
export const sideControlClass = (side: Side): string =>
  sideControlClasses[side];
