import type { SideTone } from '../../features/debate-room/speeches';

/** A side's ink and chip classes, spelled whole so the styles compile. */
export const toneInk: Readonly<Record<SideTone, string>> = {
  sky: 'text-hue-sky',
  clay: 'text-hue-clay',
  teal: 'text-hue-teal',
  plum: 'text-hue-plum',
};

export const toneChip: Readonly<Record<SideTone, string>> = {
  sky: 'bg-hue-sky-soft text-hue-sky',
  clay: 'bg-hue-clay-soft text-hue-clay',
  teal: 'bg-hue-teal-soft text-hue-teal',
  plum: 'bg-hue-plum-soft text-hue-plum',
};
