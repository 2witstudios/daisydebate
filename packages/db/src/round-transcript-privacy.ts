import { sql } from 'drizzle-orm';
import type { PrivacyAdopter } from './privacy/contracts';
import { discardPendingJudgment } from './transcript-retention';

const seatedBy = (actorId: string) =>
  sql`select id,round_id from round_participants where actor_id=${actorId}`;

/**
 * ISSUE-498: subject erasure deletes the subject's own transcript lines (text
 * and capture digest go with the row) and discards every pending AI judgment
 * of a Round they sat in, since it quotes them (DEC-223). Other debaters'
 * lines stay. Round analyses have their own adopter.
 * Export returns only the subject's own lines.
 */
export const roundTranscriptPrivacyAdopter: PrivacyAdopter = {
  id: 'round-transcript',
  phase: 'after-close',
  erase: async (tx, subject) => {
    await tx.execute(sql`delete from utterances
      where (round_participant_id,round_id) in (${seatedBy(subject.actorId)})`);
    await tx.execute(sql`update round_judging_jobs set ${discardPendingJudgment}
      where pending_ballot is not null
        and round_id in (select round_id from round_participants where actor_id=${subject.actorId})`);
  },
  export: async (tx, subject) => {
    const rows =
      (await tx.execute(sql`select id,round_id,segment_id,sequence,text,
        to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at
      from utterances where (round_participant_id,round_id) in (${seatedBy(subject.actorId)})
      order by created_at,id`)) as unknown as Record<string, unknown>[];
    return { utterances: rows };
  },
};
