import { debateRoles } from '@daisy/protocol';
import { check, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { oneOf } from './columns';
import { rounds } from './rounds';
import { seatActorId, seatRole, seatSlot, seatSlotCheck } from './seats';

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
    role: seatRole(),
    slot: seatSlot(),
  },
  (table) => [
    uniqueIndex('round_participants_actor_unique').on(
      table.roundId,
      table.actorId,
    ),
    uniqueIndex('round_participants_seat_unique').on(
      table.roundId,
      table.role,
      table.slot,
    ),
    /** Target for utterances' consistency witness. */
    uniqueIndex('round_participants_id_round_unique').on(
      table.id,
      table.roundId,
    ),
    index('round_participants_actor_idx').on(table.actorId),
    check('round_participants_role_check', oneOf(table.role, debateRoles)),
    check('round_participants_slot_check', seatSlotCheck(table.slot)),
  ],
);
