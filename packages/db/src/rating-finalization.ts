import { unresolvedAttendance } from './attendance-settlement';
import { sql } from 'drizzle-orm';

/**
 * Shared discovery/revalidation predicate over the locked Round alias `r`.
 * The finalized Round supplies the outcome; ballots prove membership and
 * transcript provenance, never a second aggregate or winner calculation.
 */
export const finalizedRatingInput = sql`
  r.status='completed' and r.ladder_id is not null
  and r.completed_at is not null and r.outcome in ('affirmative','negative','draw')
  and exists(select 1 from round_finalizations z join round_commands c on c.command_id=z.command_id and c.round_id=z.round_id
    where z.round_id=r.id and z.resulting_version=c.resulting_version and z.resulting_version <= r.version)
  and not exists(select 1 from round_check_in_attempts p
    where p.round_id=r.id and p.state='pending')
  and (
    exists(select 1 from round_attendance_adjudications a join round_finalizations z on z.round_id=a.round_id and z.command_id=a.command_id
      where a.round_id=r.id and a.decision='forfeit')
    or exists(select 1 from round_commands c
      join round_finalizations z on z.command_id=c.command_id and z.round_id=c.round_id
      where c.round_id=r.id and c.type='forfeit')
    or exists(select 1 from round_finalizations z
      join round_finalization_ballots m on m.round_id=z.round_id
      join ballots b on b.id=m.ballot_id and b.round_id=z.round_id and b.freeze_revision=z.freeze_revision
      join round_transcript_freezes f on f.round_id=z.round_id and f.revision=z.freeze_revision
      where z.round_id=r.id and f.completeness='complete'
        and not (${unresolvedAttendance(sql`r.id`, sql`r.completed_at`)}))
  )`;
