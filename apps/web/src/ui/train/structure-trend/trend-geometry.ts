/** The chart's plot area inside its 440 by 190 view box. */
const LEFT = 40;
const RIGHT = 400;
const TOP = 14;
const BOTTOM = 162;

export type TrendPoint = { readonly x: number; readonly y: number };

const round = (value: number): number => Math.round(value * 10) / 10;

/** Screen positions for percent values, oldest first, spread across the plot. */
export const trendPoints = (values: readonly number[]): readonly TrendPoint[] =>
  values.map((value, index) => ({
    x: round(
      values.length < 2
        ? RIGHT
        : LEFT + ((RIGHT - LEFT) * index) / (values.length - 1),
    ),
    y: round(
      BOTTOM - ((BOTTOM - TOP) * Math.max(0, Math.min(100, value))) / 100,
    ),
  }));

/** The line as an SVG path. */
export const linePath = (points: readonly TrendPoint[]): string =>
  points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');

/** The line closed down to the baseline, for the soft fill under it. */
export const areaPath = (points: readonly TrendPoint[]): string =>
  points.length === 0
    ? ''
    : `${linePath(points)} L${RIGHT} ${BOTTOM} L${LEFT} ${BOTTOM} Z`;

/** Baseline and gridlines: y position and label. */
export const gridlines: readonly { y: number; label: string }[] = [
  { y: BOTTOM, label: '0%' },
  { y: round((BOTTOM + TOP) / 2), label: '50%' },
  { y: TOP, label: '100%' },
];

export const plot = { left: LEFT, right: RIGHT, bottom: BOTTOM } as const;
