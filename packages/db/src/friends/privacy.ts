import { sql } from 'drizzle-orm';
import { idSchema } from '@daisy/protocol/primitives';
import type { PrivacyAdopter, PrivacyExport } from '../privacy/contracts';
import { scopeTransaction } from '../tenant-scope';
import { guardianWaitingLabel } from './guardian-approval-standing';
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
    await scopeTransaction(tx, { subjectUserId: subject.userId });
    try {
      return {
        friend_guardian_approvals: exportRows(
          await query(
            tx,
            z.object({ id: z.string(), cleared: z.boolean() }),
            sql`select id, cleared from friend_guardian_approvals
              where child_actor_id=${actorId} order by id`,
          ),
        ),
        friendships: exportRows(
          await query(
            tx,
            z.object({
              low_actor_id: z.string(),
              high_actor_id: z.string(),
              requester_actor_id: z.string(),
              state: z.enum(['pending', 'accepted', 'waiting-for-guardian']),
              requested_at: z.date(),
              accepted_at: z.date().nullable(),
            }),
            sql`select f.low_actor_id, f.high_actor_id,
              f.requester_actor_id, f.requested_at, f.accepted_at,
              case when f.state='pending' and
                ${guardianWaitingLabel(sql`f`)} = 'waiting-for-guardian'
                then 'waiting-for-guardian' else f.state end as state
              from friendships f where ${actorId} in (f.low_actor_id, f.high_actor_id)
              order by f.low_actor_id, f.high_actor_id`,
          ),
        ),
      };
    } finally {
      await scopeTransaction(tx, {});
    }
  },
};
