import { sql } from 'drizzle-orm';
import type { PrivacyAdopter } from './privacy/contracts';
import {
  identifierField as id,
  personalField,
  plainField as none,
  secretField,
  type FieldShape,
} from './privacy/field-shapes';

const fields: readonly FieldShape[] = [
  id('round_participant_id'),
  id('round_id'),
  none('freeze_revision'),
  none('status'),
  none('attempts'),
  secretField('lease_token_digest'),
  none('lease_expires_at'),
  none('model'),
  personalField('report', true),
  none('input_tokens'),
  none('output_tokens'),
  none('completed_at'),
  none('created_at'),
];

/**
 * Round analysis rows (DEC-247): each seat's report is personal and private
 * to that seat's debater, and quotes both sides' speech. Subject erasure
 * clears every analysis of a Round the subject sat in and leaves each human
 * debater seat failed with no report, so none is analysed again: a deleted
 * row would read as never analysed. Export returns the subject's own
 * seats' reports.
 */
export const roundAnalysisPrivacyAdopter: PrivacyAdopter = {
  id: 'round-analysis',
  phase: 'after-scrub',
  fields: fields.map((field) => ({
    table: 'round_analyses',
    ...field,
    storage: 'postgres' as const,
    owner: 'ANALYSIS',
    purpose:
      'Analyse one debater’s performance in a completed Round for that debater (DEC-247)',
    lawfulBasis: {
      status: 'pending' as const,
      decision: 'jc0qcdvpkmqzrelpaesi3pah',
    },
    retention: {
      status: 'approved' as const,
      decision: 'wx2xw1hckqal97frntq4o7ub',
      rule: '180 days after the analysis job is created',
    },
    erasure: 'delete' as const,
  })),
  erase: async (tx, subject) => {
    await tx.execute(sql`insert into round_analyses
        (round_id,round_participant_id,freeze_revision,status,attempts,model,completed_at)
      select distinct on (p.id) z.round_id,p.id,z.revision,'failed',1,'erased',clock_timestamp()
      from round_transcript_freezes z
      join round_participants p on p.round_id = z.round_id and p.role in ('affirmative','negative')
      join actors a on a.id = p.actor_id and a.user_id is not null
      where z.round_id in (select round_id from round_participants where actor_id=${subject.actorId})
      order by p.id, z.revision desc
      on conflict (round_participant_id) do update set status='failed',report=null,
        lease_token_digest=null,lease_expires_at=null,
        completed_at=coalesce(round_analyses.completed_at,clock_timestamp())`);
  },
  // The subject's own seats' reports: each was written for them alone.
  export: async (tx, subject) => {
    const rows = (await tx.execute(sql`select f.round_id, f.report,
        to_char(f.completed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as completed_at
      from round_analyses f
      join round_participants p on p.id = f.round_participant_id
      where p.actor_id = ${subject.actorId} and f.status = 'succeeded'
      order by f.completed_at, f.round_id`)) as unknown as Record<
      string,
      unknown
    >[];
    return { round_analyses: rows };
  },
};
