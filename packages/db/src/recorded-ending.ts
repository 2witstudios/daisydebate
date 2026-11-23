import { roundCommandTypes } from './schema/round-commands';
import { attendanceDecisions } from '@daisy/protocol/attendance';
import { listedWord } from './lifecycle-sql';
import { sql } from 'drizzle-orm';

/**
 * The one statement of how a Round ended (`RecordedEnding`), derived from its
 * finalization record. It states facts only: what an ending means for a rating
 * is the engine's `ratingEligibility`.
 */

/** Whether the finalization alias `z` was committed by a forfeit. */
export const forfeitRecorded = sql`(
  exists(select 1 from round_attendance_adjudications a
    where a.round_id=z.round_id and a.command_id=z.command_id and a.decision=${listedWord(attendanceDecisions, 'forfeit')})
  or exists(select 1 from round_commands k
    where k.round_id=z.round_id and k.command_id=z.command_id and k.type=${listedWord(roundCommandTypes, 'forfeit')}))`;

/**
 * The ending over the Round alias `r` and its finalization `z`, left joined by
 * `recordedEndingJoins`. The command foreign key on `z` proves the command
 * committed the record.
 */
export const recordedEnding = sql`case
  when z.round_id is null or z.resulting_version > r.version then 'unrecorded'
  when exists(select 1 from round_finalization_ballots m
    left join ballots b on b.id=m.ballot_id
    where m.round_id=z.round_id
      and m.ballot_digest is distinct from daisy_ballot_content_digest(b)) then 'unrecorded'
  when ${forfeitRecorded} then 'forfeit'
  when not exists(select 1 from round_finalization_ballots m
    join ballots b on b.id=m.ballot_id and b.round_id=z.round_id and b.freeze_revision=z.freeze_revision
    where m.round_id=z.round_id) then 'unjudged'
  else 'judged'
end`;

export const recordedEndingJoins = sql`
  left join round_finalizations z on z.round_id=r.id`;
