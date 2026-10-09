import { sql } from 'drizzle-orm';
import type { AuthorizationTransaction } from '../authorization';
import { buildUserInboxTopic, idSchema } from '@daisy/protocol';
import { appendOutboxEvent } from '../outbox';
/** The event says only that this owner's protected messaging collection needs a fresh read. */
export async function invalidateMessagingInboxes(
  tx: AuthorizationTransaction,
  actors: readonly string[],
) {
  const owners = [
    ...new Set(actors.map((actorId) => idSchema.parse(actorId))),
  ].sort();
  for (const actorId of owners)
    await appendOutboxEvent(tx, {
      topic: buildUserInboxTopic(actorId),
      kind: 'messaging.inbox.changed',
      version: 1,
      payload: { kind: 'messaging.inbox.changed', actorId },
    });
}
export async function invalidateDmInboxes(
  tx: AuthorizationTransaction,
  channelId: string,
) {
  const rows = await tx.execute(
    sql`select low_actor_id as "lowActorId", high_actor_id as "highActorId" from public.messaging_dm_pairs where channel_id=${channelId}`,
  );
  const pair = rows[0];
  if (pair)
    await invalidateMessagingInboxes(tx, [
      String(pair.lowActorId),
      String(pair.highActorId),
    ]);
}
