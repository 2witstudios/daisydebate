import { index, pgTable, text, unique, uniqueIndex } from 'drizzle-orm/pg-core';
import { rounds } from './rounds';
import {
  seatActorId,
  seatChecks,
  seatKindColumn,
  seatSideColumn,
  seatSlot,
} from './seats';

/**
 * One row per seat, keyed by surrogate id (ADR 0058 §2): the authoritative
 * record of that actor in that round. Everything downstream — ballots,
 * agent runs, utterances, the checkpoint's floor — names the seat, never a
 * reconstructed (round, actor) pair. A round's participants are fixed at
 * the startRound freeze, so there is no joining status or ready flag here:
 * that is Room assembly state, and it lives in `room_participants`.
 */
export const roundParticipants = pgTable(
  'round_participants',
  {
    id: text('id').primaryKey(),
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    actorId: seatActorId(),
    seatKind: seatKindColumn(),
    side: seatSideColumn(),
    slot: seatSlot(),
  },
  (table) => [
    uniqueIndex('round_participants_actor_unique').on(
      table.roundId,
      table.actorId,
    ),
    /** One occupant per seat; an unsided seat's null side is one value. */
    unique('round_participants_seat_unique')
      .on(table.roundId, table.seatKind, table.side, table.slot)
      .nullsNotDistinct(),
    /** Target for utterances' consistency witness. */
    uniqueIndex('round_participants_id_round_unique').on(
      table.id,
      table.roundId,
    ),
    index('round_participants_actor_idx').on(table.actorId),
    ...seatChecks('round_participants', table),
  ],
);
