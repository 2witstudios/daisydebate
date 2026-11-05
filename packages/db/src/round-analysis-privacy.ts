import { sql } from 'drizzle-orm';
import type { PrivacyAdopter } from './privacy/contracts';
import { analysisPurgeProjection } from './round-analysis-purge';

/** Private reports quote every frozen participant. Erasure removes content and all future dispatch authority. */
export const roundAnalysisPrivacyAdopter: PrivacyAdopter = {
  id: 'round-analysis',
  phase: 'after-close',
  erase: async (tx, subject) => {
    // Workers fence every participant first. This subject fence therefore excludes
    // all new dispatch/publication while retaining truthful original accounting.
    await tx.execute(sql`update round_analyses set work=${analysisPurgeProjection}
      where work->>'kind'<>'purged' and round_id in
      (select round_id from round_participants where actor_id=${subject.actorId})`);
  },
  export: async (tx, subject) => {
    const rows =
      await tx.execute(sql`select a.round_id,a.round_participant_id,a.freeze_revision,
      case when a.work->>'kind'='purged' then jsonb_set(a.work,'{request,calls}', coalesce((select jsonb_agg(c - 'tokenDigest') from jsonb_array_elements(a.work->'request'->'calls') c),'[]'::jsonb),false) else jsonb_set(a.work - 'lease','{calls}', coalesce((select jsonb_agg(c - 'tokenDigest') from jsonb_array_elements(a.work->'calls') c),'[]'::jsonb),false) end as work,
      to_char(a.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at
      from round_analyses a join round_participants p on p.id=a.round_participant_id
      where p.actor_id=${subject.actorId} order by a.created_at,a.round_id`);
    return { round_analyses: rows as unknown as Record<string, unknown>[] };
  },
};
