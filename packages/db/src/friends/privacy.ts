import { sql } from 'drizzle-orm';
import { idSchema } from '@daisy/protocol';
import type { PrivacyAdopter, PrivacyExport } from '../privacy/contracts';
import { exportRows } from '../privacy/export-rows';
import { run, query } from '../raw-rows';
import { z } from 'zod';

/** Friends' subject rights (ADR 0072): the subject's pairs. */
export const friendsPrivacyAdopter: PrivacyAdopter = {
  id: 'friends',
  phase: 'after-close',
  async erase(tx, subject) {
    const actorId = idSchema.parse(subject.actorId);
    await run(
      tx,
      sql`delete from friendships where low_actor_id=${actorId} or high_actor_id=${actorId}`,
    );
  },
  async export(tx, subject): Promise<PrivacyExport> {
    const actorId = idSchema.parse(subject.actorId);
    return {
      friendships: exportRows(
        await query(
          tx,
          z.object({
            low_actor_id: z.string(),
            high_actor_id: z.string(),
            requester_actor_id: z.string(),
            state: z.string(),
            requested_at: z.date(),
            accepted_at: z.date().nullable(),
          }),
          sql`select * from friendships where low_actor_id=${actorId} or high_actor_id=${actorId} order by low_actor_id,high_actor_id`,
        ),
      ),
    };
  },
};
