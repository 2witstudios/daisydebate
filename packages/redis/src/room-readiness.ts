import { idSchema } from '@daisy/protocol';
import type { RedisTransport } from './transport';
import { redisKey } from './redis-key';
import { defineScript } from './script-registry';
const readConsentScript = defineScript(`
local ready = {}
for index, key in ipairs(KEYS) do
  local value = redis.call('GET', key)
  if value then
    local ok, decoded = pcall(cjson.decode, value)
    local ttl = redis.call('PTTL', key)
    if ok and decoded.commandId == ARGV[index] and ttl > 0 then table.insert(ready, {index, ttl}) end
  end
end
return ready
`);

const consentKey = (
  namespace: string,
  roomId: string,
  version: number,
  actorId: string,
  commandId: string,
) => {
  if (!Number.isSafeInteger(version) || version < 1)
    throw new Error('Room version must be positive');
  return redisKey(
    namespace,
    'room-ready',
    idSchema.parse(roomId),
    String(version),
    idSchema.parse(actorId),
    idSchema.parse(commandId),
  );
};

export function createRoomReadinessOperations({
  client,
  namespace,
  reportFailure,
}: {
  readonly client: RedisTransport;
  readonly namespace: string;
  readonly reportFailure: (operation: string) => void;
}) {
  return {
    /** Each command owns its expiring lease: a rolled-back replacement cannot destroy the prior fence.
     * Called exactly once for a new accepted Ready; dedupe retries never enter this write. */
    async setRoomConsent(input: {
      readonly roomId: string;
      readonly version: number;
      readonly actorId: string;
      readonly commandId: string;
      readonly ttlMs: number;
    }): Promise<void> {
      if (!Number.isSafeInteger(input.ttlMs) || input.ttlMs < 1)
        throw new Error('Consent lifetime must be a positive integer');
      const key = consentKey(
        namespace,
        input.roomId,
        input.version,
        input.actorId,
        input.commandId,
      );
      idSchema.parse(input.commandId);
      try {
        await client.connect();
        await client.send('SET', [
          key,
          JSON.stringify({ commandId: input.commandId }),
          'PX',
          String(input.ttlMs),
        ]);
      } catch (error) {
        reportFailure('setRoomConsent');
        throw error;
      }
    },
    /** A lease alone is insufficient: it must match the current durable command fence. */
    async readRoomConsent(
      roomId: string,
      version: number,
      fences: readonly {
        readonly actorId: string;
        readonly commandId: string | null;
      }[],
    ): Promise<
      readonly { readonly actorId: string; readonly ttlMs: number }[]
    > {
      const ready: { actorId: string; ttlMs: number }[] = [];
      try {
        await client.connect();
        const current = fences.filter((fence) => fence.commandId !== null);
        if (!current.length) return ready;
        const keys = current.map((fence) =>
          consentKey(
            namespace,
            roomId,
            version,
            fence.actorId,
            fence.commandId!,
          ),
        );
        const indexes = await client.send('EVAL', [
          readConsentScript,
          String(keys.length),
          ...keys,
          ...current.map((fence) => fence.commandId!),
        ]);
        if (!Array.isArray(indexes))
          throw new Error('Unreadable Room consent result');
        for (const lease of indexes) {
          const [index, ttlMs] = parseConsentLease(lease);
          const fence = current[index - 1];
          if (!fence) throw new Error('Unreadable Room consent index');
          ready.push({ actorId: fence.actorId, ttlMs });
        }
        return ready;
      } catch (error) {
        reportFailure('readRoomConsent');
        throw error;
      }
    },
  };
}

function parseConsentLease(lease: unknown): readonly [number, number] {
  if (
    !Array.isArray(lease) ||
    lease.length !== 2 ||
    !Number.isSafeInteger(lease[0]) ||
    !Number.isSafeInteger(lease[1]) ||
    lease[0] < 1 ||
    lease[1] <= 0
  )
    throw new Error('Unreadable Room consent lease');
  return [lease[0], lease[1]];
}
