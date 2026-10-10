import { idSchema, messagingTypingSchemas } from '@daisy/protocol';
import { redisKey } from './redis-key';
import type { RedisTransport } from './transport';
type Lease = ReturnType<typeof messagingTypingSchemas.lease.parse>;
function page(value: unknown) {
  if (!Array.isArray(value) || value.length !== 2)
    throw new Error('Invalid typing subject scan');
  const [cursor, keys] = value;
  if (
    typeof cursor !== 'string' ||
    cursor.length > 20 ||
    !/^(0|[1-9]\d*)$/.test(cursor) ||
    !Array.isArray(keys)
  )
    throw new Error('Invalid typing subject scan');
  return { cursor, keys };
}
/** Subject rights walk every channel key, independent of current membership and lease expiry. */
export function createTypingSubjectOperations(
  client: RedisTransport,
  namespace: string,
  run: <T>(name: string, work: () => Promise<T>) => Promise<T>,
) {
  const visitSubject = async (
    actorId: string,
    visit: (key: string, channelId: string) => Promise<void>,
  ) => {
    if (!idSchema.safeParse(actorId).success)
      throw new Error('Invalid typing subject');
    const prefix = redisKey(namespace, 'messaging-typing', actorId) + ':';
    await run('typingSubject', async () => {
      let cursor = '0';
      const visited = new Set<string>();
      do {
        const result = page(
          await client.send('SCAN', [
            cursor,
            'MATCH',
            `${prefix}*`,
            'COUNT',
            '500',
          ]),
        );
        const keys = result.keys.map((key) => {
          if (typeof key !== 'string' || !key.startsWith(prefix))
            throw new Error('Invalid typing subject key');
          const channelId = key.slice(prefix.length);
          if (!idSchema.safeParse(channelId).success)
            throw new Error('Invalid typing subject key');
          return { key, channelId };
        });
        for (const key of keys) await visit(key.key, key.channelId);
        cursor = result.cursor;
        if (cursor !== '0' && visited.has(cursor))
          throw new Error('Invalid typing subject scan');
        visited.add(cursor);
      } while (cursor !== '0');
    });
  };
  return {
    async exportSubjectTyping(actorId: string): Promise<readonly Lease[]> {
      const leases = new Map<string, Lease>();
      await visitSubject(actorId, async (key, channelId) => {
        const value = await client.get(key);
        if (value === null) return;
        let parsed: ReturnType<typeof messagingTypingSchemas.lease.safeParse>;
        try {
          parsed = messagingTypingSchemas.lease.safeParse(JSON.parse(value));
        } catch {
          throw new Error('Invalid typing subject lease');
        }
        if (
          !parsed.success ||
          parsed.data.actorId !== actorId ||
          parsed.data.channelId !== channelId
        )
          throw new Error('Invalid typing subject lease');
        leases.set(channelId, parsed.data);
      });
      return [...leases.values()].sort((a, b) =>
        a.channelId.localeCompare(b.channelId),
      );
    },
    async eraseSubjectTyping(actorId: string): Promise<void> {
      await visitSubject(actorId, async (key) => {
        const removed = await client.del(key);
        if (removed !== 0 && removed !== 1)
          throw new Error('Invalid typing deletion acknowledgement');
      });
    },
  };
}
