import {
  contentModerationQueues,
  contentReportReasons,
  contentReportStatuses,
  contentReportTargetKinds,
} from '@daisy/protocol/content-moderation';
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import {
  createdAtColumn,
  isFeedbackSubjectOrNull,
  oneOf,
  timestampColumn,
} from './columns';
import { users } from './users';

/**
 * One account's report of a Round, a Recording, a chat message or abusive
 * ballot feedback (WATCH-7). Reasons are closed and there is no free text.
 * `reporterUserId` is for dedupe and export only, is never shown to an
 * operator, and erasure clears it while the report stands. `feedbackSubject`
 * says whose feedback was reported (a side key, or a ranked speaker's round
 * participant id), so the operator reads that subject's feedback alone.
 */
export const contentReports = pgTable(
  'content_reports',
  {
    id: text('id').primaryKey(),
    reporterUserId: text('reporter_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    targetKind: text('target_kind')
      .$type<(typeof contentReportTargetKinds)[number]>()
      .notNull(),
    targetId: text('target_id').notNull(),
    feedbackSubject: text('feedback_subject'),
    reason: text('reason')
      .$type<(typeof contentReportReasons)[number]>()
      .notNull(),
    queue: text('queue')
      .$type<(typeof contentModerationQueues)[number]>()
      .notNull(),
    status: text('status')
      .$type<(typeof contentReportStatuses)[number]>()
      .notNull()
      .default('open'),
    resolvedAt: timestampColumn('resolved_at'),
    resolvedByRef: text('resolved_by_ref'),
    createdAt: createdAtColumn(),
  },
  (table) => [
    uniqueIndex('content_reports_once_unique').on(
      table.reporterUserId,
      table.targetKind,
      table.targetId,
    ),
    index('content_reports_queue_idx').on(
      table.queue,
      table.status,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    check(
      'content_reports_target_kind_check',
      oneOf(table.targetKind, contentReportTargetKinds),
    ),
    check(
      'content_reports_reason_check',
      oneOf(table.reason, contentReportReasons),
    ),
    check(
      'content_reports_queue_check',
      oneOf(table.queue, contentModerationQueues),
    ),
    check(
      'content_reports_status_check',
      oneOf(table.status, contentReportStatuses),
    ),
    check(
      'content_reports_feedback_subject_check',
      sql`(${table.targetKind} = 'ballot_feedback') = (${table.feedbackSubject} is not null) and (${isFeedbackSubjectOrNull(table.feedbackSubject)})`,
    ),
    check(
      'content_reports_resolution_check',
      sql`(${table.status} = 'open') = (${table.resolvedAt} is null) and (${table.resolvedAt} is null) = (${table.resolvedByRef} is null)`,
    ),
  ],
);

/**
 * An account banned from audience interaction (WATCH-7): posting to spectator
 * chat, and whatever else needs `decideChatPost`. A row is the ban; lifting
 * deletes it, and the operator receipts keep the history.
 */
export const audienceBans = pgTable('audience_bans', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  bannedByRef: text('banned_by_ref').notNull(),
  createdAt: createdAtColumn(),
});
