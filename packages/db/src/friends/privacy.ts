import { sql } from 'drizzle-orm';
import { idSchema } from '@daisy/protocol';
import type { PrivacyAdopter, PrivacyExport } from '../privacy/contracts';
import { scopeTransaction } from '../tenant-scope';
import { liveGuardianHold } from './guardian-approval-standing';
import { exportRows } from '../privacy/export-rows';

const rowsOf = (rows: unknown) => rows as Record<string, unknown>[];

/** Friends' subject rights (ADR 0072): the subject's pairs. */
export const friendsPrivacyAdopter: PrivacyAdopter = {
  id: 'friends',
  phase: 'after-close',
  async erase(tx, subject) {
    const actorId = idSchema.parse(subject.actorId);
    await tx.execute(
      sql`delete from friendships where low_actor_id=${actorId} or high_actor_id=${actorId}`,
    );
  },
  async export(tx, subject): Promise<PrivacyExport> {
    const actorId = idSchema.parse(subject.actorId);
    await scopeTransaction(tx, { subjectUserId: subject.userId });
    try {
      return {
        friend_guardian_approvals: exportRows(
          rowsOf(
            await tx.execute(sql`select id, cleared from friend_guardian_approvals
              where child_actor_id=${actorId} order by id`),
          ),
        ),
        friendships: exportRows(
          rowsOf(
            await tx.execute(sql`select f.low_actor_id, f.high_actor_id,
              f.requester_actor_id, f.requested_at, f.accepted_at,
              case when f.state='waiting-for-guardian' and not exists (
                select 1 from friend_guardian_approvals approval
                where approval.low_actor_id=f.low_actor_id and approval.high_actor_id=f.high_actor_id
                  and approval.child_actor_id=${actorId}
                  and ${liveGuardianHold(sql`approval`, sql`f`)}
              ) then 'pending' else f.state end as state
              from friendships f where ${actorId} in (f.low_actor_id, f.high_actor_id)
              order by f.low_actor_id, f.high_actor_id`),
          ),
        ),
      };
    } finally {
      await scopeTransaction(tx, {});
    }
  },
};
