import { sql } from 'drizzle-orm';
import { idSchema } from '@daisy/protocol';
import type { PrivacyAdopter, PrivacyExport } from '../privacy/contracts';
import { exportRows } from '../privacy/export-rows';
import { run, query } from '../raw-rows';
import { z } from 'zod';

/** Challenges' subject rights (ADR 0103): every challenge naming the subject. */
export const challengesPrivacyAdopter: PrivacyAdopter = {
  id: 'challenges',
  phase: 'after-close',
  async erase(tx, subject) {
    const actorId = idSchema.parse(subject.actorId);
    await run(
      tx,
      sql`delete from challenges where challenger_actor_id=${actorId} or challenged_actor_id=${actorId}`,
    );
  },
  async export(tx, subject): Promise<PrivacyExport> {
    const actorId = idSchema.parse(subject.actorId);
    return {
      challenges: exportRows(
        await query(
          tx,
          z.object({
            id: z.string(),
            challenger_actor_id: z.string(),
            challenged_actor_id: z.string(),
            mode: z.string(),
            format_id: z.string(),
            room_id: z.string().nullable(),
            created_at: z.date(),
            expires_at: z.date(),
            follow_until: z.date().nullable(),
            division: z.string(),
          }),
          sql`select * from challenges where challenger_actor_id=${actorId} or challenged_actor_id=${actorId} order by created_at,id`,
        ),
      ),
    };
  },
};
