import { sql } from 'drizzle-orm';
import type { PrivacyAdopter } from './privacy/contracts';
/** Reuses the owning erasure's exclusive canonical account fence. No Round/user locks, audio loop or external call here. */
export const necessaryEvidencePrivacyAdopter: PrivacyAdopter = {
  id: 'necessary-evidence',
  phase: 'after-close',
  erase: async (tx, subject) => {
    await tx.execute(sql`insert into necessary_evidence_erasure_requests(actor_id,user_id)
      values(${subject.actorId},${subject.userId}) on conflict(actor_id) do nothing`);
  },
  export: async (tx, subject) => {
    const rows = await tx.execute(sql`select actor_id,user_id,phase,
      to_char(requested_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as requested_at,
      to_char(propagated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as propagated_at
      from necessary_evidence_erasure_requests where actor_id=${subject.actorId} and user_id=${subject.userId}`);
    return {
      necessary_evidence_erasure_requests: rows as unknown as Record<
        string,
        unknown
      >[],
    };
  },
};
