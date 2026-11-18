import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  pgTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
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
 * reconstructed (round, actor) pair. Competitors freeze at Start; judge
 * identities are immutable while current occupants belong to the Round's
 * append-only assignment lineage (DEC417). Ready belongs to Room assembly.
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
    /** Observed pre-migration rated identity; runtime can never set this marker. */
    legacyRatingParticipant: boolean('legacy_rating_participant')
      .notNull()
      .default(false),
    /** Internal candidate key: a rating names a debater or its observed historical identity. */
    ratingActorId: text('rating_actor_id').generatedAlwaysAs(
      sql`case when seat_kind in ('side','speaker') or legacy_rating_participant then actor_id else null end`,
    ),
  },
  (table) => [
    uniqueIndex('round_participants_fixed_actor_unique')
      .on(table.roundId, table.actorId)
      .where(sql`${table.seatKind}<>'judge'`),
    uniqueIndex('round_participants_rating_actor_unique').on(
      table.roundId,
      table.ratingActorId,
    ),
    index('round_participants_round_actor_idx').on(
      table.roundId,
      table.actorId,
    ),
    uniqueIndex('round_participants_fixed_seat_unique')
      .on(
        table.roundId,
        table.seatKind,
        sql`coalesce(${table.side},'')`,
        table.slot,
      )
      .where(sql`${table.seatKind}<>'judge'`),
    unique('round_participants_assignment_identity_unique').on(
      table.id,
      table.roundId,
      table.slot,
      table.actorId,
    ),
    /** Target for utterances' consistency witness. */
    uniqueIndex('round_participants_id_round_unique').on(
      table.id,
      table.roundId,
    ),
    index('round_participants_actor_idx').on(table.actorId),
    ...seatChecks('round_participants', table),
  ],
);
