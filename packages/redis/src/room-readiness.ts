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
    if ok and decoded.commandId == ARGV[index] then table.insert(ready, index) end
  end
end
return ready
`);

const consentKey = (
  namespace: string,
  roomId: string,
  version: number,
  actorId: string,
) => {
  if (!Number.isSafeInteger(version) || version < 1)
    throw new Error('Room version must be positive');
  return redisKey(
    namespace,
    'room-ready',
    idSchema.parse(roomId),
    String(version),
    idSchema.parse(actorId),
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
    /** Called exactly once for a new accepted Ready; dedupe retries never enter this write. */
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
    ): Promise<readonly string[]> {
      const ready: string[] = [];
      try {
        await client.connect();
        const current = fences.filter((fence) => fence.commandId !== null);
        if (!current.length) return ready;
        const keys = current.map((fence) =>
          consentKey(namespace, roomId, version, fence.actorId),
        );
        const indexes = await client.send('EVAL', [
          readConsentScript,
          String(keys.length),
          ...keys,
          ...current.map((fence) => fence.commandId!),
        ]);
        if (!Array.isArray(indexes))
          throw new Error('Unreadable Room consent result');
        for (const index of indexes) {
          const fence = current[Number(index) - 1];
          if (fence) ready.push(fence.actorId);
        }
        return ready;
      } catch (error) {
        reportFailure('readRoomConsent');
        throw error;
      }
    },
  };
}
