import { idSchema, messagingTypingSchemas } from '@daisy/protocol';
import type { RedisTransport } from './transport';
import { redisKey } from './redis-key';
import { defineScript } from './script-registry';
type Lease = ReturnType<typeof messagingTypingSchemas.lease.parse>;
const readScript = defineScript("return redis.call('MGET', unpack(KEYS))");
const positive = (value: number) => Number.isSafeInteger(value) && value > 0;
function ids(
  channelId: string,
  actorIds: readonly string[],
  maxActors: number,
) {
  if (
    !idSchema.safeParse(channelId).success ||
    !positive(maxActors) ||
    maxActors > 65535 ||
    actorIds.length > maxActors ||
    new Set(actorIds).size !== actorIds.length ||
    !actorIds.every((actor) => idSchema.safeParse(actor).success)
  )
    throw new Error('Invalid typing lease input');
}
function decoded(
  value: unknown,
  channelId: string,
  actorId: string,
): Lease | null {
  if (value === null) return null;
  try {
    if (typeof value !== 'string') throw new Error();
    const row = messagingTypingSchemas.lease.safeParse(JSON.parse(value));
    if (
      row.success &&
      row.data.channelId === channelId &&
      row.data.actorId === actorId
    )
      return row.data;
  } catch {
    /* Refuse malformed driver data below without exposing its contents. */
  }
  throw new Error('Invalid typing lease response');
}
export function createMessagingTypingOperations({
  client,
  namespace,
  reportFailure,
}: {
  readonly client: RedisTransport;
  readonly namespace: string;
  readonly reportFailure: (operation: string) => void;
}) {
  const key = (channelId: string, actorId: string) =>
    redisKey(namespace, 'messaging-typing', actorId, channelId);
  const run = async <T>(name: string, work: () => Promise<T>) => {
    try {
      await client.connect();
      return await work();
    } catch (error) {
      reportFailure(name);
      throw error;
    }
  };
  return {
    async writeTypingLease(input: Lease, ttlMs: number) {
      const lease = messagingTypingSchemas.lease.safeParse(input);
      if (!lease.success || !positive(ttlMs))
        throw new Error('Invalid typing lease input');
      await run('writeTypingLease', () =>
        client.send('SET', [
          key(lease.data.channelId, lease.data.actorId),
          JSON.stringify(lease.data),
          'PX',
          String(ttlMs),
        ]),
      );
    },
    async clearTypingLease(channelId: string, actorId: string) {
      ids(channelId, [actorId], 1);
      await run('clearTypingLease', () => client.del(key(channelId, actorId)));
    },
    async readTypingLeases(
      channelId: string,
      actorIds: readonly string[],
      maxActors: number,
    ): Promise<readonly Lease[]> {
      ids(channelId, actorIds, maxActors);
      if (actorIds.length === 0) return [];
      return run('readTypingLeases', async () => {
        const raw = await client.send('EVAL', [
          readScript,
          String(actorIds.length),
          ...actorIds.map((actor) => key(channelId, actor)),
        ]);
        if (!Array.isArray(raw) || raw.length !== actorIds.length)
          throw new Error('Invalid typing lease response');
        return raw.flatMap((value, index) => {
          const row = decoded(value, channelId, actorIds[index]!);
          return row ? [row] : [];
        });
      });
    },
  };
}
