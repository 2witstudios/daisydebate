import { pgTable, text } from 'drizzle-orm/pg-core';
import { timestampColumn } from './columns';
import { rounds } from './rounds';
/** Presence with null withdrawal is known-open; an absent row is not recovery authority. */
export const necessaryEvidenceRounds = pgTable(
  'necessary_evidence_round_fences',
  {
    roundId: text('round_id')
      .primaryKey()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    withdrawnAt: timestampColumn('withdrawn_at'),
  },
);
