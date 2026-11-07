import { sql } from 'drizzle-orm';
import type { BoundedTransactionContext } from '../transaction-context';
import type { Policy } from './policy';
import { hasUnenrolledOriginals } from './readiness';
/** Alias c belongs to the recognition context. retryAt is eligibility only, never fair-turn priority. */
export const due = (
  options: Policy,
) => sql`c.next_attempt_at<=clock_timestamp() and (
 c.status in ('queued','retry') or (c.status='collecting' and c.last_source_at<=clock_timestamp()-${options.quietMs}*interval '1 millisecond') or (c.status='leased' and c.lease_expires_at<=clock_timestamp()))
 and (c.model is null or (c.model=${options.model} and c.policy_digest=${options.policyDigest}))
 and not ${hasUnenrolledOriginals(sql`c.round_id`)}
 and exists(select 1 from transcription_recovery_sources s where s.context_id=c.id)
 and not exists(select 1 from transcription_recovery_sources s join necessary_evidence e on e.id=s.evidence_id where s.context_id=c.id and (
   e.state<>'retained' or e.payload_accepted_at is null or e.expires_at<=clock_timestamp() or e.original_subject_actor_ids is null or e.original_speaker is null or e.authority_id is null
   or exists(select 1 from necessary_evidence_erasure_requests p where p.actor_id=any(e.original_subject_actor_ids))
   or exists(select 1 from actors a join users u on u.id=a.user_id where a.id=any(e.original_subject_actor_ids) and u.deleted_at is not null)))`;
/** Bounded distinct eligible Rounds before LIMIT; another worker's live Round claim excludes all its siblings. No locks precede account discovery. */
export async function discover(tx: BoundedTransactionContext, options: Policy) {
  return (await tx.execute(sql`select chosen.id as "contextId",r.id as "roundId" from rounds r cross join lateral (
   select c.id from transcription_recovery_contexts c where c.round_id=r.id and ${due(options)} order by c.created_at,c.id limit 1
 ) chosen where r.status='active'
 and not exists(select 1 from round_transcript_freezes f where f.round_id=r.id)
 and not exists(select 1 from necessary_evidence_round_fences f where f.round_id=r.id and f.withdrawn_at is not null)
 and not exists(select 1 from transcription_recovery_contexts live where live.round_id=r.id and live.status='leased' and live.lease_expires_at>clock_timestamp())
 order by (select coalesce(max(history.last_claimed_at),min(history.created_at)) from transcription_recovery_contexts history where history.round_id=r.id),r.id limit 8`)) as unknown as {
    contextId: string;
    roundId: string;
  }[];
}
