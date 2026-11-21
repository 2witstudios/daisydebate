import { oweNotifications, resurfaceNotifications } from '../notifications/owe';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { query } from '../raw-rows';
import type { Tx } from '../tx';

/** The request pair and the child's account are already locked by the caller. */
export async function holdForGuardian(
  tx: Pick<Tx, 'execute' | 'insert'>,
  input: {
    readonly pair: {
      readonly lowActorId: string;
      readonly highActorId: string;
    };
    readonly childActorId: string;
    readonly at: string;
    readonly nextId: () => string;
  },
) {
  const { pair, childActorId, at, nextId } = input;
  const guardians = await query(
    tx,
    z.object({ user_id: z.string() }),
    sql`select user_id from public.daisy_hold_friend_request(
      ${nextId()}, ${pair.lowActorId}, ${pair.highActorId}, ${childActorId})`,
  );
  if (!guardians.length) return;

  const kind = 'friend_guardian_approval' as const;
  const subject = {
    friendship_low_actor_id: pair.lowActorId,
    friendship_high_actor_id: pair.highActorId,
  };
  await resurfaceNotifications(tx, {
    kind,
    subject,
    userIds: guardians.map(({ user_id }) => user_id),
    at,
    nextId,
  });
  await oweNotifications(tx, {
    kind,
    subject,
    recipients: guardians.map(({ user_id }) => ({
      userId: user_id,
      about: childActorId,
    })),
    at,
    nextId,
  });
}
