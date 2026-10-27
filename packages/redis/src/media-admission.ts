import { idSchema } from '@daisy/protocol';
import { redisKey } from './redis-key';
import { defineScript } from './script-registry';
import type { RedisTransport } from './transport';

/** Expendable scheduling hints, never lease or admission authority. */
const waiters = defineScript(`
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if ARGV[1] == 'enter' then
  if redis.call('ZCARD', KEYS[1]) >= 256 and not redis.call('ZSCORE', KEYS[1], ARGV[2]) then return -1 end
  redis.call('ZADD', KEYS[1], now + 15000, ARGV[2])
  redis.call('PEXPIRE', KEYS[1], 15000)
elseif ARGV[1] == 'leave' then
  redis.call('ZREM', KEYS[1], ARGV[2])
end
local count = redis.call('ZCARD', KEYS[1])
if count == 0 then redis.call('DEL', KEYS[1]) end
return count
`);
export function createMediaAdmissionHints(input: {
  readonly client: RedisTransport;
  readonly namespace: string;
  readonly reportFailure: (operation: string) => void;
}) {
  return {
    async mediaAdmissionHint(
      sessionId: string,
      operation: 'enter' | 'leave' | 'waiting',
      waiterId?: string,
    ) {
      if (
        !idSchema.safeParse(sessionId).success ||
        (operation !== 'waiting' && !idSchema.safeParse(waiterId).success)
      )
        throw new Error('Invalid media admission hint');
      try {
        await input.client.connect();
        const count = await input.client.send('EVAL', [
          waiters,
          '1',
          redisKey(input.namespace, 'media-admission', sessionId),
          operation,
          waiterId ?? '',
        ]);
        if (Number(count) < 0)
          throw new Error('Media admission hint capacity exceeded');
        return Number(count) > 0;
      } catch (error) {
        input.reportFailure('mediaAdmissionHint');
        throw error;
      }
    },
  };
}
