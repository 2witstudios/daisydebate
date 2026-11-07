import { pgTable, text } from 'drizzle-orm/pg-core';
import { timestampColumn } from './columns';
import { necessaryEvidence } from './necessary-evidence';
/** One actual discovery offer per original intent, never payload acceptance or permission to decrypt/dispatch. */
export const transcriptionRecoveryEnrollmentOffers = pgTable(
  'transcription_recovery_enrollment_offers',
  {
    evidenceId: text('evidence_id')
      .primaryKey()
      .references(() => necessaryEvidence.id, { onDelete: 'cascade' }),
    lastOfferedAt: timestampColumn('last_offered_at').notNull(),
  },
);
