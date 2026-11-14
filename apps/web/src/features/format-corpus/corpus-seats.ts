import {
  everySeatOf,
  sameSeat,
  type RoundParticipantSeat,
  type RoundRules,
  type SeatRef,
} from '@daisy/protocol';

/** A seat as the authority reads it: every corpus seat is an eligible human. */
export type CorpusSeat = RoundParticipantSeat & {
  readonly kind: 'human';
  readonly eligible: true;
};

/** The id word a seat had as a role: its side, or its kind. */
const wordOf = (seat: SeatRef): string =>
  seat.kind === 'side' ? seat.side : seat.kind;

/** A deterministic 24-character id, as the protocol's id grammar requires. */
const idOf = (prefix: string, seat: SeatRef) =>
  `${prefix}${wordOf(seat)}${seat.slot}`.padEnd(24, '0');

/** One seat for every slot the rules declare, sides first, then judges. */
export const seatsOf = (
  rules: Pick<RoundRules, 'sides' | 'seats'>,
): readonly CorpusSeat[] =>
  everySeatOf(rules).map((seat) => ({
    id: idOf('seat', seat),
    actorId: idOf('user', seat),
    seat,
    kind: 'human' as const,
    eligible: true as const,
  }));

/** The participant holding `seat`; throws when the rules declared none. */
export const seatAt = (
  seats: readonly CorpusSeat[],
  seat: SeatRef,
): CorpusSeat => {
  const found = seats.find((s) => sameSeat(s.seat, seat));
  if (!found) throw new Error(`No ${wordOf(seat)} seat in slot ${seat.slot}`);
  return found;
};

/** The corpus's first instant; every other instant is an offset from it. */
export const corpusStartMs = Date.parse('2026-10-06T09:00:00.000Z');

/** An ISO instant `ms` after the corpus start. */
export const corpusAt = (ms: number): string =>
  new Date(corpusStartMs + ms).toISOString();
