import {
  RECORDING_EVIDENCE_HOLD_MS,
  transitionRecording,
} from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import type { PrivacyAdopter } from './privacy/contracts';
import { moveRecording } from './recording-move';

const seatedRounds = (actorId: string) =>
  sql`select round_id from round_participants where actor_id=${actorId}`;

/**
 * ADR 0107. Asking for erasure is asking for each casual Recording the subject
 * sits in to go, whole, so this records that intent in the erasure's transaction
 * and the deletion sweep carries it out. A taken-down one under an open report
 * stays hidden as evidence, with the removal owed: it goes when the report closes
 * or the hold's 90 days pass. Ranked Recordings are kept: they are their own
 * declared class, proposed until counsel reviews it (compliance.md). Export names
 * the Recordings the subject appears in, never another's data.
 */
export const recordingPrivacyAdopter: PrivacyAdopter = {
  id: 'recording',
  phase: 'after-close',
  erase: async (tx, subject, { now }) => {
    const rows = (await tx.execute(sql`select rec.id,
        exists(select 1 from content_reports c where c.status='open' and (
          (c.target_kind='recording' and c.target_id=rec.id)
          or (c.target_kind='round' and c.target_id=rec.round_id))) as reported
      from recordings rec
      where rec.recording_class='casual'
        and rec.status not in ('removing','removed')
        and rec.round_id in (${seatedRounds(subject.actorId)})
      order by rec.id`)) as unknown as {
      readonly id: string;
      readonly reported: boolean;
    }[];
    const heldUntil = new Date(
      Date.parse(now) + RECORDING_EVIDENCE_HOLD_MS,
    ).toISOString();
    for (const { id, reported } of rows)
      await moveRecording(tx, id, (record) =>
        transitionRecording(record, {
          type: 'removal_requested',
          cause: 'participant_request',
          at: now,
          ...(reported ? { evidenceHeldUntil: heldUntil } : {}),
        }),
      );
  },
  export: async (tx, subject) => {
    const rows =
      (await tx.execute(sql`select id,round_id,recording_class,status,
        to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at
      from recordings where round_id in (${seatedRounds(subject.actorId)})
      order by created_at,id`)) as unknown as Record<string, unknown>[];
    return { recordings: rows };
  },
};
