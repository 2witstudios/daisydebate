import { sql } from 'drizzle-orm';
import { oweNotifications } from '../notifications/owe';
import { rowsOf } from '../raw-rows';
import type { Tx } from '../tx';

export async function tellFriend(
  tx: Pick<Tx, 'execute' | 'insert'>,
  {
    kind,
    pair,
    recipientActorId,
    about,
    at,
    nextId,
  }: {
    readonly kind: 'friend_request_received' | 'friend_request_accepted';
    readonly pair: {
      readonly lowActorId: string;
      readonly highActorId: string;
    };
    readonly recipientActorId: string;
    readonly about: string;
    readonly at: string;
    readonly nextId: () => string;
  },
) {
  const members = await rowsOf<{ user_id: string }>(
    tx,
    sql`select user_id from actors where id=${recipientActorId} and user_id is not null`,
  );
  await oweNotifications(tx, {
    kind,
    subject: {
      friendship_low_actor_id: pair.lowActorId,
      friendship_high_actor_id: pair.highActorId,
    },
    recipients: members.map(({ user_id }) => ({ userId: user_id, about })),
    at,
    nextId,
  });
}
