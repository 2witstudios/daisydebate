import { sql } from 'drizzle-orm';
import { idSchema } from '@daisy/protocol';
import type { PrivacyAdopter, PrivacyExport } from '../privacy/contracts';
import { exportRows } from '../privacy/export-rows';

const rowsOf = (rows: unknown) => rows as Record<string, unknown>[];

/** Friends' subject rights (ADR 0072): the subject's pairs and challenges. */
export const friendsPrivacyAdopter: PrivacyAdopter = {
  id: 'friends',
  phase: 'after-scrub',
  async erase(tx, subject) {
    const actorId = idSchema.parse(subject.actorId);
    await tx.execute(
      sql`delete from friend_challenges where challenger_actor_id=${actorId} or challenged_actor_id=${actorId}`,
    );
    await tx.execute(
      sql`delete from friendships where low_actor_id=${actorId} or high_actor_id=${actorId}`,
    );
  },
  async export(tx, subject): Promise<PrivacyExport> {
    const actorId = idSchema.parse(subject.actorId);
    return {
      friendships: exportRows(
        rowsOf(
          await tx.execute(
            sql`select * from friendships where low_actor_id=${actorId} or high_actor_id=${actorId} order by low_actor_id,high_actor_id`,
          ),
        ),
      ),
      friend_challenges: exportRows(
        rowsOf(
          await tx.execute(
            sql`select * from friend_challenges where challenger_actor_id=${actorId} or challenged_actor_id=${actorId} order by created_at,room_id`,
          ),
        ),
      ),
    };
  },
};
