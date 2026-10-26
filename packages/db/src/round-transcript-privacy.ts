import { sql } from 'drizzle-orm';
import type {
  PrivacyAdopter,
  PrivacyFieldDeclaration,
} from './privacy/contracts';
import { discardPendingJudgment } from './transcript-retention';

type Field = Pick<
  PrivacyFieldDeclaration,
  'column' | 'category' | 'visibility' | 'exportable'
>;
const id = (column: string, exportable = false): Field => ({
  column,
  category: 'identifier',
  exportable,
});
const none = (column: string, exportable = false): Field => ({
  column,
  category: 'none',
  exportable,
});
const personal = (column: string, exportable: boolean): Field => ({
  column,
  category: 'personal',
  visibility: 'private',
  exportable,
});

/** The media-persistence and pending-judging-response inventories, as declarations. */
const tables = [
  {
    table: 'utterances',
    purpose: 'Private seated-participant transcript of the Round (DEC-101)',
    retention: {
      status: 'approved',
      decision: 'fl3arsnxh0szhgrinjh2ccup',
      rule: '180 days after the utterance is recorded',
    },
    fields: [
      id('id', true),
      id('round_id', true),
      id('segment_id', true),
      id('round_participant_id'),
      none('sequence', true),
      personal('text', true),
      none('complete'),
      id('clip_key'),
      id('capture_track_id'),
      none('capture_start_offset_ms'),
      none('capture_duration_ms'),
      none('capture_worker_epoch'),
      personal('capture_body_digest', false),
      none('created_at', true),
    ],
  },
  {
    table: 'round_judging_jobs',
    purpose:
      'Recover a validated AI judging response without a second provider dispatch',
    retention: {
      status: 'approved',
      decision: 'wx2xw1hckqal97frntq4o7ub',
      rule: '180 days after the response is received',
    },
    fields: [
      personal('pending_ballot', false),
      id('pending_ballot_agent_run_id'),
      none('pending_ballot_epoch'),
      none('pending_ballot_received_at'),
    ],
  },
] as const;

const seatedBy = (actorId: string) =>
  sql`select id,round_id from round_participants where actor_id=${actorId}`;

/**
 * ISSUE-498: subject erasure deletes the subject's own transcript lines (text
 * and capture digest go with the row) and discards every pending AI judgment
 * of a Round they sat in, since it quotes them (DEC-223). Other debaters'
 * lines stay. Export returns only the subject's own lines.
 */
export const roundTranscriptPrivacyAdopter: PrivacyAdopter = {
  id: 'round-transcript',
  phase: 'after-scrub',
  fields: tables.flatMap(({ table, purpose, retention, fields }) =>
    fields.map((field) => ({
      table,
      ...field,
      storage: 'postgres' as const,
      owner: 'VIDEO',
      purpose,
      lawfulBasis: {
        status: 'pending' as const,
        decision: 'jc0qcdvpkmqzrelpaesi3pah',
      },
      retention,
      erasure: 'delete' as const,
    })),
  ),
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
