import { pgTable, text } from 'drizzle-orm/pg-core';
import { timestampColumn } from './columns';
import { rounds } from './rounds';

/**
 * What the incident feature itself remembers between passes, written only by it. It reads
 * the room's retirement from `media_room_rotations`, never writing on media's rows.
 */
export const roundIncidentWatches = pgTable('round_incident_watches', {
  roundId: text('round_id')
    .primaryKey()
    .references(() => rounds.id, { onDelete: 'cascade' }),
  /** When a pass first failed to reach the vendor; a pass that reads it clears this. */
  unreachableSince: timestampColumn('unreachable_since'),
  /** The last room retirement a decision has taken up. */
  retirementTakenUpAt: timestampColumn('retirement_taken_up_at'),
});
