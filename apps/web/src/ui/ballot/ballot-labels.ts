import type { DebateSide as Side } from '@daisy/protocol';

export const sideNames: Readonly<Record<Side, string>> = {
  affirmative: 'Affirmative',
  negative: 'Negative',
};

export const sideShort: Readonly<Record<Side, string>> = {
  affirmative: 'Aff',
  negative: 'Neg',
};

/** A debater's first name, for column heads and tight labels. */
export const firstName = (name: string): string => name.split(/\s+/)[0] ?? name;
