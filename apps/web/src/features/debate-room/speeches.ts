import type { SeatRef, SideKey } from '@daisy/protocol/seats';

/**
 * A side's colour in the room, by its place in the format's declared order
 * (TAB-6.17): the first side is sky and the second clay, as a two-sided
 * Round has always read; an unsided speaker is teal.
 */
const sideTones = ['sky', 'clay', 'teal', 'plum'] as const;
export type SideTone = (typeof sideTones)[number];

/** The tone of a seat's side; an unsided seat reads teal. */
export const sideToneOf = (
  sides: readonly { readonly key: SideKey }[],
  side: SideKey | null,
): SideTone => {
  const index = side === null ? -1 : sides.findIndex((s) => s.key === side);
  return index === -1
    ? 'teal'
    : (sideTones[index % sideTones.length] ?? 'teal');
};

export type SpeechSlot = {
  readonly id: string;
  readonly code: string;
  /** The full name, "Negative constructive"; the code is its short form. */
  readonly name: string;
  /** The seat the segment is scheduled to; null for an open floor. */
  readonly lead: SeatRef | null;
  readonly kind: 'speech' | 'cross-ex' | 'open';
  readonly durationMs: number;
};
