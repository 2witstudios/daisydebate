import { z } from 'zod';

/**
 * The one seat vocabulary (TAB-6): a seat belongs to a side, is an unsided
 * speaker, a judge, or a moderator. Every seat map, CHECK constraint and
 * seat rule derives from this array.
 */
export const seatKinds = ['side', 'speaker', 'judge', 'moderator'] as const;
export const seatKindSchema = z.enum(seatKinds);
export type SeatKind = (typeof seatKinds)[number];

/**
 * A side's stored identity: a short lowercase key a format declares. It is
 * never a seat-kind word, so a seat key cannot be read two ways.
 */
export const sideKeyPattern = /^[a-z][a-z_]{0,23}$/;
export const sideKeySchema = z
  .string()
  .regex(sideKeyPattern)
  .refine((key) => !(seatKinds as readonly string[]).includes(key), {
    message: 'A side key is never a seat kind',
  });
export type SideKey = string;

/** One side a format declares: its stored key and how people read it. */
export const sideSchema = z.strictObject({
  key: sideKeySchema,
  label: z.string().trim().min(1).max(40),
  short: z.string().trim().min(1).max(8),
});
export type Side = z.infer<typeof sideSchema>;

/**
 * The two-sided preset: every two-sided format declares these. The only
 * place a side's key is written as a literal outside tests (TAB-6.2).
 */
export const affirmativeSide = 'affirmative';
export const negativeSide = 'negative';
export const twoSides = [
  { key: affirmativeSide, label: 'Affirmative', short: 'Aff' },
  { key: negativeSide, label: 'Negative', short: 'Neg' },
] as const satisfies readonly Side[];
/** The two-sided preset's keys, affirmative first. */
export const twoSideKeys = [affirmativeSide, negativeSide] as const;
export type TwoSideKey = (typeof twoSideKeys)[number];

/** The four-team preset: two benches, opening and closing. */
export const fourTeams = [
  {
    key: 'opening_government',
    label: 'Opening Government',
    short: 'OG',
  },
  { key: 'opening_opposition', label: 'Opening Opposition', short: 'OO' },
  { key: 'closing_government', label: 'Closing Government', short: 'CG' },
  { key: 'closing_opposition', label: 'Closing Opposition', short: 'CO' },
] as const satisfies readonly Side[];

const slotSchema = z.int().min(0);

/** One seat, by kind; a side seat also names its side. */
export const seatRefSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('side'),
    side: sideKeySchema,
    slot: slotSchema,
  }),
  z.strictObject({ kind: z.literal('speaker'), slot: slotSchema }),
  z.strictObject({ kind: z.literal('judge'), slot: slotSchema }),
  z.strictObject({ kind: z.literal('moderator'), slot: slotSchema }),
]);
export type SeatRef =
  | { readonly kind: 'side'; readonly side: SideKey; readonly slot: number }
  | { readonly kind: 'speaker'; readonly slot: number }
  | { readonly kind: 'judge'; readonly slot: number }
  | { readonly kind: 'moderator'; readonly slot: number };
export type SideSeat = Extract<SeatRef, { kind: 'side' }>;

export const sideSeat = (side: SideKey, slot = 0): SeatRef => ({
  kind: 'side',
  side,
  slot,
});
export const judgeSeat = (slot = 0): SeatRef => ({ kind: 'judge', slot });

export const isJudgeSeat = (seat: SeatRef): boolean => seat.kind === 'judge';
export const isSideSeat = (seat: SeatRef): seat is SideSeat =>
  seat.kind === 'side';
export const isModeratorSeat = (seat: SeatRef): boolean =>
  seat.kind === 'moderator';
/** A competitor's seat: a side's seat or an unsided speaker's. */
export const isDebatingSeat = (seat: SeatRef): boolean =>
  seat.kind === 'side' || seat.kind === 'speaker';
/** A seat that may ever hold the floor: anyone but a judge. */
export const isSpeakingSeat = (seat: SeatRef): boolean => seat.kind !== 'judge';

/** The side a seat belongs to, or null for an unsided seat. */
export const sideOfSeat = (seat: SeatRef): SideKey | null =>
  seat.kind === 'side' ? seat.side : null;

/** The seat's one stable key: `affirmative:0`, `speaker:2`, `judge:0`. */
export const seatKey = (seat: SeatRef): string =>
  seat.kind === 'side'
    ? `${seat.side}:${seat.slot}`
    : `${seat.kind}:${seat.slot}`;

export const sameSeat = (a: SeatRef, b: SeatRef): boolean =>
  seatKey(a) === seatKey(b);

/**
 * The seat kinds in display and heir order: competitors first (sides in
 * their declared order, then unsided speakers), the moderator, then judges.
 */
export const seatOrder =
  (sides: readonly { readonly key: SideKey }[]) =>
  (a: SeatRef, b: SeatRef): number => {
    const rank = (seat: SeatRef): number => {
      switch (seat.kind) {
        case 'side': {
          const index = sides.findIndex((side) => side.key === seat.side);
          return index === -1 ? sides.length : index;
        }
        case 'speaker':
          return sides.length + 1;
        case 'moderator':
          return sides.length + 2;
        case 'judge':
          return sides.length + 3;
      }
    };
    return rank(a) - rank(b) || a.slot - b.slot;
  };

/**
 * The other side of a two-sided format. Only the pairwise concepts call it
 * (forfeit by absence, the resolution strike, low-point win, ratings), and
 * each states the two-sided precondition by calling it.
 */
export const otherSide = (
  sides: readonly { readonly key: SideKey }[],
  side: SideKey,
): SideKey => {
  const [first, second, ...rest] = sides;
  if (!first || !second || rest.length > 0)
    throw new Error('The other side exists only in a two-sided format');
  if (side === first.key) return second.key;
  if (side === second.key) return first.key;
  throw new Error(`Unknown side ${side}`);
};

/** Whether a format's sides are exactly two: the pairwise precondition. */
export const isTwoSided = (sides: readonly unknown[]): boolean =>
  sides.length === 2;

/** A seat as people read it: the side's label or the seat kind, numbered past one. */
export const seatLabel = (
  sides: readonly Side[],
  seat: SeatRef,
  seatsOfKind: number,
): string => {
  const numbered = (name: string) =>
    seatsOfKind > 1 ? `${name} ${seat.slot + 1}` : name;
  switch (seat.kind) {
    case 'side':
      return numbered(
        sides.find((side) => side.key === seat.side)?.label ?? seat.side,
      );
    case 'speaker':
      return numbered('Speaker');
    case 'moderator':
      return numbered('Moderator');
    case 'judge':
      return numbered('Judge');
  }
};
