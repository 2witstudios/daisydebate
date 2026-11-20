import {
  contentReportCreateSchema,
  queueOfReason,
  type ContentReportCreate,
} from '@daisy/protocol/content-moderation';
import { idSchema } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import type { Tx } from './tx';
import { run } from './raw-rows';

/**
 * A profile's text keeps its target id across edits (ADR 0143), so a repeat
 * report of it may be about new text: a resolved one reopens with the new
 * reason, but only once that field's text changed after it was resolved
 * (both times by the database clock), so a dismissed report cannot be pushed
 * back into the queue unchanged. An open
 * one stays as it is, since its operator reads the current text. Every other
 * target is reported once per reporter.
 */
const onRepeat = (report: ContentReportCreate) =>
  report.targetKind === 'profile_display_name' ||
  report.targetKind === 'profile_bio'
    ? sql`on conflict (reporter_user_id, target_kind, target_id) do update set
        reason = excluded.reason, queue = excluded.queue, status = 'open',
        created_at = now(), resolved_at = null, resolved_by_ref = null
        where content_reports.status <> 'open'
          and exists (select 1 from member_profiles m
            where m.id = excluded.target_id
              and (case excluded.target_kind
                when 'profile_display_name' then m.display_name_changed_at
                else m.bio_changed_at end) > content_reports.resolved_at)`
    : sql`on conflict do nothing`;

/** Content Reports owns the one closed-reason, deduplicated write; callers supply current target authority. */
export async function insertContentReport(
  tx: Tx,
  input: {
    readonly id: string;
    readonly reporterUserId: string;
    readonly report: ContentReportCreate;
    readonly feedbackSubject: string | null;
  },
) {
  const report = contentReportCreateSchema.parse(input.report);
  idSchema.parse(input.id);
  idSchema.parse(input.reporterUserId);
  await run(
    tx,
    sql`insert into content_reports(id,reporter_user_id,target_kind,target_id,feedback_subject,reason,queue)
 values(${input.id},${input.reporterUserId},${report.targetKind},${report.targetId},${input.feedbackSubject},${report.reason},${queueOfReason(report.reason)}) ${onRepeat(report)}`,
  );
}
