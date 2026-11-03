import { sql } from 'drizzle-orm';

/**
 * The one statement of how a Round ended (`RecordedEnding`), derived from its
 * finalization record. It states facts only: what an ending means for a rating
 * is the engine's `ratingEligibility`.
 */

/** Whether the finalization alias `z` was committed by a forfeit. */
export const forfeitRecorded = sql`(
  exists(select 1 from round_attendance_adjudications a
    where a.round_id=z.round_id and a.command_id=z.command_id and a.decision='forfeit')
  or exists(select 1 from round_commands k
    where k.round_id=z.round_id and k.command_id=z.command_id and k.type='forfeit'))`;

/**
 * The ending over the Round alias `r`, its finalization `z` and that
 * finalization's freeze `f`, all left joined by `recordedEndingJoins`. The
 * command foreign key on `z` proves the command committed the record.
 */
export const recordedEnding = sql`case
  when z.round_id is null or z.resulting_version > r.version then 'unrecorded'
  when ${forfeitRecorded} then 'forfeit'
  when not exists(select 1 from round_finalization_ballots m
    join ballots b on b.id=m.ballot_id and b.round_id=z.round_id and b.freeze_revision=z.freeze_revision
    where m.round_id=z.round_id) then 'unjudged'
  when f.completeness='complete' then 'judged-on-complete-capture'
  else 'judged-on-incomplete-capture'
end`;

export const recordedEndingJoins = sql`
  left join round_finalizations z on z.round_id=r.id
  left join round_transcript_freezes f on f.round_id=z.round_id and f.revision=z.freeze_revision`;
