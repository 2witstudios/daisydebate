import type { SeatKind, SeatRef, SideKey } from './seats';
import { isSpeakingSeat, seatKey, seatOrder } from './seats';

/** Provisional resource budget: bounds expanded seat records and per-seat command work,
 * independent of any league roster policy. Judges consume the same budget. */
export const MAX_FORMAT_SEATS = 256;

/**
 * A format's seating, read the one way (TAB-6.2): its declared sides and how
 * many seats of each kind it has. A definition and its compiled rules both
 * carry it, so every reader asks these questions of either.
 */
export type FormatSeating = {
  readonly sides: readonly { readonly key: SideKey }[];
  readonly seats: {
    readonly sides: Readonly<Record<SideKey, number>>;
    readonly speakers: number;
    readonly judges: number;
    readonly moderators: number;
  };
};

/** Who may hold the floor in a segment (TAB-6.2). */
export type SpeakRights =
  | { readonly rights: 'one'; readonly seat: SeatRef }
  | {
      readonly rights: 'several';
      readonly seats: readonly SeatRef[];
      readonly lead: SeatRef | null;
    }
  | { readonly rights: 'all'; readonly lead: SeatRef | null };

/** The sides' keys, in declared order. */
export const sideKeysOf = (seating: Pick<FormatSeating, 'sides'>): SideKey[] =>
  seating.sides.map((side) => side.key);

/** How many seats a seat's kind (or side) declares. */
export const seatCountFor = (seating: FormatSeating, seat: SeatRef): number => {
  switch (seat.kind) {
    case 'side':
      return seating.sides.some((side) => side.key === seat.side)
        ? (seating.seats.sides[seat.side] ?? 0)
        : 0;
    case 'speaker':
      return seating.seats.speakers;
    case 'judge':
      return seating.seats.judges;
    case 'moderator':
      return seating.seats.moderators;
  }
};

/** Whether the format declares this seat. */
export const seatExists = (seating: FormatSeating, seat: SeatRef): boolean =>
  seat.slot < seatCountFor(seating, seat);

/** Every seat the format declares, in display order. */
export const everySeatOf = (seating: FormatSeating): SeatRef[] => {
  const slots = (count: number) => Array.from({ length: count }, (_, i) => i);
  return [
    ...seating.sides.flatMap((side) =>
      slots(seating.seats.sides[side.key] ?? 0).map((slot): SeatRef => ({
        kind: 'side',
        side: side.key,
        slot,
      })),
    ),
    ...slots(seating.seats.speakers).map((slot): SeatRef => ({
      kind: 'speaker',
      slot,
    })),
    ...slots(seating.seats.moderators).map((slot): SeatRef => ({
      kind: 'moderator',
      slot,
    })),
    ...slots(seating.seats.judges).map((slot): SeatRef => ({
      kind: 'judge',
      slot,
    })),
  ].sort(seatOrder(seating.sides));
};

/** How many seats the format declares in all, judges included. */
export const seatTotalOf = (seating: FormatSeating): number =>
  everySeatOf(seating).length;

/**
 * The seats a segment's speak rights grant the floor to: one seat, several,
 * or every seat but a judge's.
 */
export const speakingSeatsOf = (
  seating: FormatSeating,
  speak: SpeakRights,
): readonly SeatRef[] => {
  switch (speak.rights) {
    case 'one':
      return [speak.seat];
    case 'several':
      return speak.seats;
    case 'all':
      return everySeatOf(seating).filter(isSpeakingSeat);
  }
};

/** The seat a segment is scheduled to: the speaker, or the asker; null for an open floor. */
export const leadSeatOf = (speak: SpeakRights): SeatRef | null =>
  speak.rights === 'one' ? speak.seat : speak.lead;

/** How many seats of a kind the format declares; a side seat counts every side's. */
export const seatsOfKind = (seating: FormatSeating, kind: SeatKind): number => {
  switch (kind) {
    case 'side':
      return seating.sides.reduce(
        (sum, side) => sum + (seating.seats.sides[side.key] ?? 0),
        0,
      );
    case 'speaker':
      return seating.seats.speakers;
    case 'judge':
      return seating.seats.judges;
    case 'moderator':
      return seating.seats.moderators;
  }
};

/**
 * True when the held seats are exactly the seats the format declares: every
 * side's slots, and every unsided kind's, are exactly 0..n-1 and nothing
 * else is held. The room freeze and the round start both enforce it.
 */
export const heldSeatsComplete = (
  seating: FormatSeating,
  held: readonly SeatRef[],
): boolean => {
  const declared = everySeatOf(seating).map(seatKey).sort();
  const taken = held.map(seatKey).sort();
  return (
    declared.length === taken.length &&
    declared.every((key, index) => key === taken[index])
  );
};
