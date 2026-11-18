/**
 * One grid for the score sheet's rows and total. Its tracks follow the
 * sheet's own width (`@container` on the sheet): wide, the category and the
 * two sides share a line; narrow, the category heads one row per side.
 */
export const ballotGridClass = (subjects: number): string =>
  `grid grid-cols-2 items-center gap-x-4 ${ballotColumns(subjects).row}`;

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

/**
 * A subject's colour by its tone: its side's place in the format's declared
 * order. The first side reads in the accent and the second in clay, as
 * everywhere a two-sided Round names its sides; a third and fourth in sky
 * and plum.
 */
const toned = <T>(tones: readonly [T, ...T[]], tone: number): T =>
  tones[tone % tones.length] ?? tones[0];

const textTones = [
  'text-accent',
  'text-hue-clay',
  'text-hue-sky',
  'text-hue-plum',
] as const;

export const sideTextClass = (tone: number): string => toned(textTones, tone);

const controlTones = [
  'accent-accent',
  'accent-hue-clay',
  'accent-hue-sky',
  'accent-hue-plum',
] as const;

/** A native control filled in its subject's colour. */
export const sideControlClass = (tone: number): string =>
  toned(controlTones, tone);

/**
 * The wide sheet's tracks: the category's two, then one per scored subject
 * (up to four a line). `row` widens a row; `head` is the column heads'.
 */
export const ballotColumns = (
  subjects: number,
): { readonly row: string; readonly head: string } => {
  switch (Math.min(Math.max(subjects, 1), 4)) {
    case 1:
      return { row: '@ballot-sheet:grid-cols-3', head: 'grid-cols-3' };
    case 2:
      return { row: '@ballot-sheet:grid-cols-4', head: 'grid-cols-4' };
    case 3:
      return { row: '@ballot-sheet:grid-cols-5', head: 'grid-cols-5' };
    default:
      return { row: '@ballot-sheet:grid-cols-6', head: 'grid-cols-6' };
  }
};
