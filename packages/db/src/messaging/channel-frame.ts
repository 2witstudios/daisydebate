import { eq, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { lockAuthorizationActors } from '../authorization';
import { messagingChannels } from '../schema/messaging-channels';
import { messagingContactPairs } from '../schema/messaging-social';
import { readMessagingChannelFact, type MessagingChannelFact } from './social';
import type { MessagingChannelStore } from './records';
type Input = Parameters<MessagingChannelStore['withChannel']>[0];
type Frame = {
  readonly tx: Pick<BunSQLDatabase, 'select' | 'insert' | 'update' | 'execute'>;
  readonly channel: typeof messagingChannels.$inferSelect;
  readonly fact: MessagingChannelFact;
  readonly accounts: Awaited<ReturnType<typeof lockAuthorizationActors>>;
};
const actorIdsOf = (fact: MessagingChannelFact, actorId: string) =>
  [
    ...new Set([
      actorId,
      ...(fact.authority.kind === 'dm'
        ? [fact.authority.lowActorId, fact.authority.highActorId]
        : fact.authority.activeMemberActorIds),
    ]),
  ].sort();

/** Shared by the message and file frames; every wait precedes fresh authority. */
export async function withMessagingChannel<T>(
  database: BunSQLDatabase,
  input: Input,
  work: (frame: Frame) => Promise<T>,
): Promise<T> {
  for (const id of [input.channelId, input.actorId, input.userId])
    if (!idSchema.safeParse(id).success) throw createAppError('VALIDATION');
  return database.transaction(async (tx) => {
    // Discover only authority identities; no message/receipt content is read.
    const discovered = await readMessagingChannelFact(
      tx,
      input.channelId,
      input.actorId,
    );
    if (!discovered) throw createAppError('NOT_FOUND');
    const actors = actorIdsOf(discovered, input.actorId);
    const accounts = await lockAuthorizationActors(tx, actors, {
      maxActors: 65535,
    });
    if (discovered.authority.kind === 'dm')
      await tx.execute(sql`
          select low_actor_id from ${messagingContactPairs}
          where low_actor_id = ${discovered.authority.lowActorId} and high_actor_id = ${discovered.authority.highActorId}
          for update
        `);
    const [channel] = await tx
      .select()
      .from(messagingChannels)
      .where(eq(messagingChannels.id, input.channelId))
      .for('update');
    if (!channel) throw createAppError('NOT_FOUND');
    const fact = await readMessagingChannelFact(
      tx,
      input.channelId,
      input.actorId,
    );
    if (!fact) throw createAppError('NOT_FOUND');
    if (
      JSON.stringify(actors) !== JSON.stringify(actorIdsOf(fact, input.actorId))
    )
      throw createAppError('CONFLICT');
    return work({ tx, channel, fact, accounts });
  });
}
