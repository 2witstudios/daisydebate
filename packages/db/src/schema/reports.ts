import { reportOutcomes, reportReasons, reportSurfaces } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { oneOf, timestampColumn } from './columns';
import { actors } from './actors';
import { contactActorColumn } from './contacts';

/**
 * One member's report of another (ADR 0098): a bounded reason and where it
 * was made, never a copy of any conversation. `purge_after` starts when it
 * closes, from the proposed evidence retention (DEC-298, COMP-4).
 */
export const reports = pgTable(
  'reports',
  {
    id: text('id').primaryKey(),
    /** Null once the reporter's account is erased: the report outlives them. */
    reporterActorId: text('reporter_actor_id').references(() => actors.id, {
      onDelete: 'restrict',
    }),
    subjectActorId: contactActorColumn('subject_actor_id'),
    reason: text('reason').notNull(),
    surface: text('surface').notNull(),
    createdAt: timestampColumn('created_at').notNull(),
    closedAt: timestampColumn('closed_at'),
    outcome: text('outcome'),
    operatorRef: text('operator_ref'),
    purgeAfter: timestampColumn('purge_after'),
  },
  (table) => [
    index('reports_queue_idx').on(table.closedAt, table.createdAt, table.id),
    index('reports_reporter_idx').on(table.reporterActorId),
    index('reports_subject_idx').on(table.subjectActorId),
    index('reports_purge_idx')
      .on(table.purgeAfter)
      .where(sql`${table.purgeAfter} is not null`),
    uniqueIndex('reports_one_open_per_pair')
      .on(table.reporterActorId, table.subjectActorId)
      .where(sql`${table.closedAt} is null`),
    check(
      'reports_distinct',
      sql`${table.reporterActorId} <> ${table.subjectActorId}`,
    ),
    check('reports_reason_check', oneOf(table.reason, reportReasons)),
    check('reports_surface_check', oneOf(table.surface, reportSurfaces)),
    check(
      'reports_outcome_check',
      sql`${table.outcome} is null or ${oneOf(table.outcome, reportOutcomes)}`,
    ),
    check(
      'reports_closed_check',
      sql`(${table.closedAt} is null) = (${table.outcome} is null)
        and (${table.closedAt} is null) = (${table.operatorRef} is null)
        and (${table.closedAt} is null) = (${table.purgeAfter} is null)`,
    ),
  ],
);
