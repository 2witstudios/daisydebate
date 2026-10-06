import type { Side } from '../../features/debates/turns';

/**
 * One grid for the score sheet's rows and total. Its tracks follow the
 * sheet's own width (`@container` on the sheet): wide, the category and the
 * two sides share a line; narrow, the category heads one row per side.
 */
export const ballotGridClass =
  'grid grid-cols-2 items-center gap-x-4 @ballot-sheet:grid-cols-4 @ballot-sheet:gap-x-6';

/** The category column: a full line when narrow, half the row when wide. */
export const ballotLabelCellClass = 'col-span-2 min-w-0';

/** One side's column; a full row of its own when the sheet is narrow. */
export const ballotSideCellClass =
  'col-span-2 min-w-0 @ballot-sheet:col-span-1';

/** A section of the ballot: a tone-separated card with a display heading. */
export const ballotSectionClass =
  'flex flex-col gap-4 rounded-xl bg-surface p-6 shadow-1 max-compact:p-4 max-narrow:p-3';

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
