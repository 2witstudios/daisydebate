import type { SideKey } from '@daisy/protocol/seats';

/** Side tones in declared order, so a two-sided Room keeps sky then clay. */
const sideTones = [
  'bg-hue-sky-soft text-hue-sky',
  'bg-hue-clay-soft text-hue-clay',
  'bg-hue-plum-soft text-hue-plum',
] as const;

/** A side's tone by its place among the format's sides. */
export const sideTone = (
  sides: readonly { readonly key: SideKey }[],
  side: SideKey,
): string =>
  sideTones[
    Math.max(
      0,
      sides.findIndex((declared) => declared.key === side),
    ) % sideTones.length
  ] ?? sideTones[0];

/** The tone every unsided competitor shares. */
export const speakerTone = sideTones[0];
/** The tone of the officials: judges and the moderator. */
export const officialTone = 'bg-hue-teal-soft text-hue-teal';
