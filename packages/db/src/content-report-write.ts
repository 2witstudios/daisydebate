import {
  contentReportCreateSchema,
  queueOfReason,
  type ContentReportCreate,
} from '@daisy/protocol/content-moderation';
import { idSchema } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import type { AuthorizationTransaction } from './authorization';

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
 values(${input.id},${input.reporterUserId},${report.targetKind},${report.targetId},${input.feedbackSide},${report.reason},${queueOfReason(report.reason)}) on conflict do nothing`);
}
