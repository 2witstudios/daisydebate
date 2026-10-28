import { sql } from 'drizzle-orm';
import { idSchema } from '@daisy/protocol';
import type { PrivacyAdopter, PrivacyExport } from '../privacy/contracts';
import {
  exportRows,
  ownedTableExpectedColumns,
  ownedTablePrivacyFields,
} from '../privacy/owned-tables';

const friendsColumns = {
  friendships: {
    identifier: [],
    personal: [
      'low_actor_id',
      'high_actor_id',
      'requester_actor_id',
      'state',
      'requested_at',
      'accepted_at',
    ],
    none: [],
  },
  friend_challenges: {
    identifier: ['room_id'],
    personal: ['challenger_actor_id', 'challenged_actor_id', 'created_at'],
    none: [],
  },
} as const;

export const friendsPrivacyExpectedColumns =
  ownedTableExpectedColumns(friendsColumns);

export const friendsPrivacyFields = ownedTablePrivacyFields({
  owner: 'FRIENDS',
  columns: friendsColumns,
  purpose: (table) =>
    table === 'friendships'
      ? 'Friendship requests and friends'
      : 'Friend challenge to a room',
});

const rowsOf = (rows: unknown) => rows as Record<string, unknown>[];

/** Friends' subject rights (ADR 0072): the subject's pairs and challenges. */
export const friendsPrivacyAdopter: PrivacyAdopter = {
  id: 'friends',
  phase: 'after-scrub',
  fields: friendsPrivacyFields,
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
