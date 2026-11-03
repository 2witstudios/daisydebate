import { sql } from 'drizzle-orm';
import type { PrivacyAdopter } from './privacy/contracts';

const seatedRounds = (actorId: string) =>
  sql`select round_id from round_participants where actor_id=${actorId}`;

/**
 * ADR 0103. Asking for erasure is asking for each casual Recording the subject
 * sits in to go, whole, so this records that intent in the erasure's transaction
 * and the deletion sweep carries it out. Ranked Recordings are kept: they are
 * their own declared class, proposed until counsel reviews it (compliance.md).
 * Export names the Recordings the subject appears in, never another's data.
 */
export const recordingPrivacyAdopter: PrivacyAdopter = {
  id: 'recording',
  phase: 'after-close',
  erase: async (tx, subject, { now }) => {
    await tx.execute(sql`update recordings set
        status='removing',
        lifecycle=jsonb_build_object('status','removing','cause','participant_request','requestedAt',${now}::text),
        version=version+1,
        deletion_due_at=${now}::timestamptz,
        deletion_attempts=0,
        updated_at=${now}::timestamptz
      where recording_class='casual'
        and status not in ('removing','removed')
        and round_id in (${seatedRounds(subject.actorId)})`);
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
