import { sql } from 'drizzle-orm';
/** Distinct eligible original-content Rounds. Custody refusal is handled outside this metadata-only query. */
export const missingRounds = sql`select r.id as round_id,chosen.id as evidence_id,
 coalesce((select max(s.enrolled_at) from transcription_recovery_sources s join necessary_evidence e on e.id=s.evidence_id where e.original_round_id=r.id),
 (select min(e.created_at) from necessary_evidence e where e.original_round_id=r.id)) as turn_at from rounds r cross join lateral (
  select e.id from necessary_evidence e left join transcription_recovery_enrollment_offers offered on offered.evidence_id=e.id where e.round_id=r.id and e.original_round_id=r.id
   and e.state='retained' and e.payload_accepted_at is not null and e.expires_at>clock_timestamp()
   and e.original_subject_actor_ids is not null and e.original_speaker is not null and e.authority_id is not null
   and not exists(select 1 from transcription_recovery_sources s where s.evidence_id=e.id)
   and not exists(select 1 from necessary_evidence_erasure_requests p where p.actor_id=any(e.original_subject_actor_ids))
   and not exists(select 1 from actors a join users u on u.id=a.user_id where a.id=any(e.original_subject_actor_ids) and u.deleted_at is not null)
   order by coalesce(offered.last_offered_at,e.created_at),e.id limit 1
 ) chosen where r.status='active'
  and not exists(select 1 from round_transcript_freezes f where f.round_id=r.id)
  and not exists(select 1 from necessary_evidence_round_fences f where f.round_id=r.id and f.withdrawn_at is not null)
`;
