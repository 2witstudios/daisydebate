import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  lockAuthorizationActors,
  type AuthorizationTransaction,
} from '../authorization';
import { messagingChannels } from '../schema/messaging-channels';
import { messagingContactPairs } from '../schema/messaging-social';
import { readMessagingChannelFact, type MessagingChannelFact } from './social';
type Scope = {
  readonly channelId: string;
  readonly actorId: string;
  readonly userId: string;
};
type AuthorityFrame = {
  readonly tx: AuthorizationTransaction;
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

/** Authority only: canonical accounts -> pair -> id-only channel lock -> fresh cast/facts. */
export async function withLockedMessagingAuthority<T>(
  tx: AuthorizationTransaction,
  input: Scope,
  work: (frame: AuthorityFrame) => Promise<T>,
): Promise<T> {
  for (const id of [input.channelId, input.actorId, input.userId])
    if (!idSchema.safeParse(id).success) throw createAppError('VALIDATION');
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
    where low_actor_id=${discovered.authority.lowActorId} and high_actor_id=${discovered.authority.highActorId} for update
  `);
  const rows = await tx.execute(
    sql`select id from ${messagingChannels} where id=${input.channelId} for update`,
  );
  if (!rows[0]) throw createAppError('NOT_FOUND');
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
  return work({ tx, fact, accounts });
}
/** Public database factory binds its pool; the consumer evaluates policy in this same tx. */
export function createMessagingChannelAuthority(database: BunSQLDatabase) {
  return <T>(
    input: Scope,
    work: (frame: AuthorityFrame) => Promise<T>,
  ): Promise<T> =>
    database.transaction((tx) => withLockedMessagingAuthority(tx, input, work));
}
