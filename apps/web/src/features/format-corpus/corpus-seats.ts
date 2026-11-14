import type {
  DebateRole,
  RoundParticipantSeat,
  RoundRules,
} from '@daisy/protocol';

const roles = [
  'affirmative',
  'negative',
  'judge',
] as const satisfies readonly DebateRole[];

/** A seat as the authority reads it: every corpus seat is an eligible human. */
export type CorpusSeat = RoundParticipantSeat & {
  readonly kind: 'human';
  readonly eligible: true;
};

/** A deterministic 24-character id, as the protocol's id grammar requires. */
const idOf = (prefix: string, role: DebateRole, slot: number) =>
  `${prefix}${role}${slot}`.padEnd(24, '0');

/** One seat for every slot the rules declare, sides first, then judges. */
export const seatsOf = (
  rules: Pick<RoundRules, 'seats'>,
): readonly CorpusSeat[] =>
  roles.flatMap((role) =>
    Array.from({ length: rules.seats[role] }, (_, slot) => ({
      id: idOf('seat', role, slot),
      actorId: idOf('user', role, slot),
      role,
      slot,
      kind: 'human' as const,
      eligible: true as const,
    })),
  );

/** The seat holding `role` and `slot`; throws when the rules declared none. */
export const seatAt = (
  seats: readonly CorpusSeat[],
  role: DebateRole,
  slot: number,
): CorpusSeat => {
  const seat = seats.find((s) => s.role === role && s.slot === slot);
  if (!seat) throw new Error(`No ${role} seat in slot ${slot}`);
  return seat;
};

/** The corpus's first instant; every other instant is an offset from it. */
export const corpusStartMs = Date.parse('2026-10-06T09:00:00.000Z');

/** An ISO instant `ms` after the corpus start. */
export const corpusAt = (ms: number): string =>
  new Date(corpusStartMs + ms).toISOString();
