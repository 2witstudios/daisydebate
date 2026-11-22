import { addMs } from '@daisy/clock';
import { RECORDING_EVIDENCE_HOLD_MS } from '@daisy/protocol/recording';
import { transitionRecording } from '@daisy/protocol/recording-lifecycle';
import { sql } from 'drizzle-orm';
import type { PrivacyAdopter } from './privacy/contracts';
import { endRoundFeed } from './broadcast-operations';
import { moveRecording } from './recording-move';
import { query } from './raw-rows';
import { z } from 'zod';

const seatedRounds = (actorId: string) =>
  sql`select round_id from round_participants where actor_id=${actorId}`;

/**
 * ADR 0107. Asking for erasure is asking for each casual Recording the subject
 * sits in to go, whole, so this records that intent in the erasure's transaction
 * and the deletion sweep carries it out. A taken-down one under an open report
 * stays hidden as evidence, with the removal owed: it goes when the report closes
 * or the hold's 90 days pass. Whatever moves also ends the Round's open feed, and one
 * taken down has had its feed ended already. Ranked Recordings are kept: they are their own
 * declared class, proposed until counsel reviews it (compliance.md). Export names
 * the Recordings the subject appears in, never another's data.
 */
export const recordingPrivacyAdopter: PrivacyAdopter = {
  id: 'recording',
  phase: 'after-close',
  erase: async (tx, subject, { now }) => {
    const rows = await query(
      tx,
      z.object({ id: z.string(), reported: z.boolean() }),
      sql`select rec.id,
        exists(select 1 from content_reports c where c.status='open' and (
          (c.target_kind='recording' and c.target_id=rec.id)
          or (c.target_kind='round' and c.target_id=rec.round_id))) as reported
      from recordings rec
      where rec.recording_class='casual'
        and rec.status not in ('removing','removed')
        and rec.round_id in (${seatedRounds(subject.actorId)})
      order by rec.id`,
    );
    const heldUntil = addMs(now, RECORDING_EVIDENCE_HOLD_MS);
    for (const { id, reported } of rows) {
      const applied = await moveRecording(tx, id, (record) =>
        transitionRecording(record, {
          type: 'removal_requested',
          cause: 'participant_request',
          at: now,
          ...(reported ? { evidenceHeldUntil: heldUntil } : {}),
        }),
      );
      if (applied.kind === 'decided' && applied.transition.kind === 'moved')
        await endRoundFeed(tx, {
          roundId: applied.record.roundId,
          reason: 'recording_removed_by_erasure',
          now: new Date(now),
        });
    }
  },
  export: async (tx, subject) => {
    const rows = await query(
      tx,
      z.object({
        id: z.string(),
        round_id: z.string(),
        recording_class: z.string(),
        status: z.string(),
        created_at: z.string(),
      }),
      sql`select id,round_id,recording_class,status,
        to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at
      from recordings where round_id in (${seatedRounds(subject.actorId)})
      order by created_at,id`,
    );
    return { recordings: rows };
  },
};
