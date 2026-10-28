import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { buildChannelTopic, serverMessageSchema } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import type { AuthorizationTransaction } from '../authorization';
import {
  restartingRead,
  withSharedMessagingAuthority,
} from './authority-frame';
import { readMessagingChannelFact } from './social';
/** Lossy aggregate invalidation only: no durable cursor or actor/content fields. */
async function notifyMessagingTyping(
  tx: AuthorizationTransaction,
  channelId: string,
) {
  const frame = serverMessageSchema.parse({
    v: 1,
    type: 'typing_changed',
    topic: buildChannelTopic(channelId),
  });
  await tx.execute(
    sql`select pg_notify('daisy_realtime_hints',${JSON.stringify(frame)})`,
  );
}
/**
 * Same sorted account -> pair -> channel order under shared fences: typing
 * writes no rows (its leases are Redis, its hint a notification), so peers
 * typing in one channel never serialize (MSG-2.1-arch1). Each peer's own
 * grant is read after the waits.
 */
export function createMessagingTypingStore(database: BunSQLDatabase) {
  type Scope = Parameters<typeof withSharedMessagingAuthority>[1];
  type Authority = Parameters<
    Parameters<typeof withSharedMessagingAuthority>[2]
  >[0];
  type Frame = Authority & {
    readonly channels: readonly {
      readonly actorId: string;
      readonly fact: Awaited<ReturnType<typeof readMessagingChannelFact>>;
    }[];
    readonly notify: () => Promise<void>;
  };
  return <T>(
    scope: Scope,
    maxActors: number,
    work: (frame: Frame) => Promise<T>,
  ): Promise<T> => {
    if (!Number.isSafeInteger(maxActors) || maxActors < 1 || maxActors > 65535)
      throw createAppError('VALIDATION');
    return restartingRead(database, (tx) =>
      withSharedMessagingAuthority(tx, scope, async (authority) => {
        if (authority.accounts.length > maxActors)
          throw createAppError('INFRASTRUCTURE');
        const actors =
          authority.fact.authority.kind === 'dm'
            ? [
                authority.fact.authority.lowActorId,
                authority.fact.authority.highActorId,
              ]
            : authority.fact.authority.activeMemberActorIds;
        const channels = [];
        for (const actorId of actors)
          channels.push({
            actorId,
            fact: await readMessagingChannelFact(tx, scope.channelId, actorId),
          });
        return work({
          ...authority,
          channels,
          notify: () => notifyMessagingTyping(tx, scope.channelId),
        });
      }),
    );
  };
}
