import { judgingJobStatuses } from '@daisy/protocol/round-panel-completion';
import { competitionTypes } from '@daisy/protocol/round';
import { listedWord } from './lifecycle-sql';
import { sql } from 'drizzle-orm';
import type { PrivacyAdopter } from './privacy/contracts';
import {
  clearJudgingStages,
  discardPendingJudgment,
} from './transcript-retention';
import { run, query } from './raw-rows';
import { z } from 'zod';

const seatedBy = (actorId: string) =>
  sql`select id,round_id from round_participants where actor_id=${actorId}`;

/** Ranked lines are ranked content: the transcript stands behind the result. */
const seatedOnNonRanked = (actorId: string) =>
  sql`select p.id,p.round_id from round_participants p
    join rounds r on r.id=p.round_id
    where p.actor_id=${actorId} and r.competition_type <> ${listedWord(competitionTypes, 'ranked')}`;

/**
 * ISSUE-498: subject erasure deletes the subject's own transcript lines (text
 * and capture digest go with the row) and discards every pending AI judgment
 * of a Round they sat in, since it quotes them (DEC-223), with its stage
 * records: the first-pass ballot and the case map (ADR 0125). A ranked Round is
 * exempt: its lines and judgment are ranked content and stay (ISSUE-1089,
 * proposed until counsel reviews it). Other debaters' lines stay. Round analyses have their own adopter.
 * Export returns only the subject's own lines.
 */
export const roundTranscriptPrivacyAdopter: PrivacyAdopter = {
  id: 'round-transcript',
  phase: 'after-close',
  erase: async (tx, subject) => {
    await run(
      tx,
      sql`delete from utterances
      where (round_participant_id,round_id) in (${seatedOnNonRanked(subject.actorId)})`,
    );
    await run(
      tx,
      sql`update round_judging_jobs set ${discardPendingJudgment}
      where pending_ballot is not null
        and round_id in (select round_id from (${seatedOnNonRanked(subject.actorId)}) seats)`,
    );
    // Open work whose stage records go ends as a held response does, so no
    // later claim re-buys them from what is left of the transcript (ADR 0125).
    await run(
      tx,
      sql`update round_judging_jobs set ${discardPendingJudgment},${clearJudgingStages}
      where (first_ballot is not null or case_map is not null)
        and status not in (${listedWord(judgingJobStatuses, 'succeeded')},${listedWord(judgingJobStatuses, 'failed')})
        and round_id in (select round_id from (${seatedOnNonRanked(subject.actorId)}) seats)`,
    );
    await run(
      tx,
      sql`update round_judging_jobs set ${clearJudgingStages}
      where (first_ballot is not null or case_map is not null)
        and round_id in (select round_id from (${seatedOnNonRanked(subject.actorId)}) seats)`,
    );
  },
  export: async (tx, subject) => {
    const rows = await query(
      tx,
      z.object({
        id: z.string(),
        round_id: z.string(),
        segment_id: z.string(),
        sequence: z.int(),
        text: z.string(),
        created_at: z.string(),
      }),
      sql`select id,round_id,segment_id,sequence,text,
        to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at
      from utterances where (round_participant_id,round_id) in (${seatedBy(subject.actorId)})
      order by created_at,id`,
    );
    return { utterances: rows };
  },
};
