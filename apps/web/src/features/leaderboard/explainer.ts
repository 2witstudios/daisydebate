import { linearScale } from './history';

/** Sample ratings and ranges for the "provisional and established" picture. */
const samples = [
  { key: 'provisional', label: 'Provisional', rating: 1450, range: 340 },
  { key: 'established', label: 'Established', rating: 1620, range: 110 },
] as const;

const AXIS: readonly [number, number] = [1000, 2000];

export type RangeBar = {
  readonly key: string;
  readonly label: string;
  readonly x1: number;
  readonly x2: number;
  readonly dot: number;
  readonly y: number;
};

/** The two sample ranges as bars across a chart of the given width. */
export function rangeBars(width: number): readonly RangeBar[] {
  const x = linearScale(AXIS, [0, width]);
  return samples.map((sample, i) => ({
    key: sample.key,
    label: sample.label,
    x1: Math.round(x(sample.rating - sample.range)),
    x2: Math.round(x(sample.rating + sample.range)),
    dot: Math.round(x(sample.rating)),
    y: 20 + i * 36,
  }));
}
