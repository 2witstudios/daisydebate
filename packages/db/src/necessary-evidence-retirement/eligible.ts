import { sql } from 'drizzle-orm';
/** Positive persisted retirement facts only. No transcript/provider-success or unreceived-age shortcut. Alias e is owned here. */
export const eligible = sql`
  e.next_attempt_at<=clock_timestamp() and (
    (e.state='retiring' and e.retirement_reason is not null and
      (e.lease_expires_at is null or e.lease_expires_at<=clock_timestamp())) or
    (e.state in ('acquiring','retained') and (
      exists(select 1 from necessary_evidence_round_fences f where f.round_id=e.original_round_id and f.withdrawn_at is not null) or
      exists(select 1 from necessary_evidence_erasure_requests p where p.actor_id=any(e.original_subject_actor_ids)) or
      (e.state='retained' and e.expires_at<=clock_timestamp())
    ))
  )`;
