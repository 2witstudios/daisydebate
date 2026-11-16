import {
  contentReportCreateSchema,
  queueOfReason,
  type ContentReportCreate,
} from '@daisy/protocol/content-moderation';
import { idSchema } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import type { AuthorizationTransaction } from './authorization';

/**
 * A profile's text keeps its target id across edits (ADR 0143), so a repeat
 * report of it may be about new text: a resolved one reopens with the new
 * reason. An open one stays as it is, since its operator reads the current
 * text. Every other target is reported once per reporter.
 */
const onRepeat = (report: ContentReportCreate) =>
  report.targetKind === 'profile_display_name' ||
  report.targetKind === 'profile_bio'
    ? sql`on conflict (reporter_user_id, target_kind, target_id) do update set
        reason = excluded.reason, queue = excluded.queue, status = 'open',
        created_at = now(), resolved_at = null, resolved_by_ref = null
        where content_reports.status <> 'open'`
    : sql`on conflict do nothing`;

/** Content Reports owns the one closed-reason, deduplicated write; callers supply current target authority. */
export async function insertContentReport(
  tx: Pick<AuthorizationTransaction, 'execute'>,
  input: {
    readonly id: string;
    readonly reporterUserId: string;
    readonly report: ContentReportCreate;
    readonly feedbackSide: string | null;
  },
) {
  const report = contentReportCreateSchema.parse(input.report);
  idSchema.parse(input.id);
  idSchema.parse(input.reporterUserId);
  await tx.execute(sql`insert into content_reports(id,reporter_user_id,target_kind,target_id,feedback_side,reason,queue)
 values(${input.id},${input.reporterUserId},${report.targetKind},${report.targetId},${input.feedbackSide},${report.reason},${queueOfReason(report.reason)}) ${onRepeat(report)}`);
}
