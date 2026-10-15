import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { buildChannelTopic, serverMessageSchema } from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import type { AuthorizationTransaction } from '../authorization';
import {
  retrySharedRead,
  withLockedMessagingAuthority,
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
/** Same sorted account -> pair -> channel fence; each peer's own grant is read after waits. */
export function createMessagingTypingStore(database: BunSQLDatabase) {
  type Scope = Parameters<typeof withLockedMessagingAuthority>[1];
  type Authority = Parameters<
    Parameters<typeof withLockedMessagingAuthority>[2]
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
    operation: 'read' | 'write',
  ): Promise<T> => {
    if (!Number.isSafeInteger(maxActors) || maxActors < 1 || maxActors > 65535)
      throw createAppError('VALIDATION');
    const project = async (authority: Authority) => {
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
          fact: await readMessagingChannelFact(
            authority.tx,
            scope.channelId,
            actorId,
          ),
        });
      return work({
        ...authority,
        channels,
        // Only a lease mutation publishes the lossy aggregate hint; a read
        // that tried to notify would be a caller contract break.
        notify:
          operation === 'write'
            ? () => notifyMessagingTyping(authority.tx, scope.channelId)
            : () => Promise.reject(createAppError('CONFLICT')),
      });
    };
    // A read takes compatible shared fences in its own restartable
    // transaction; only a lease mutation needs the exclusive frame.
    if (operation === 'read')
      return retrySharedRead(database, (tx) =>
        withSharedMessagingAuthority(tx, scope, project),
      );
    return database.transaction((tx) =>
      withLockedMessagingAuthority(tx, scope, project),
    );
  };
}
