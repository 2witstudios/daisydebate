import { redisKey } from './redis-key';
import { defineScript } from './script-registry';
import type { RedisTransport } from './transport';
import type { RateLimitRule } from './index';

// Request decisions expire, are never renewed, and debit both buckets only on the first miss.
const reservationScript = defineScript(`
local prior = redis.call('GET', KEYS[1])
if prior then return {tonumber(prior), math.max(0, redis.call('PTTL', KEYS[1]))} end
local allowed = 1
local wait = 0
for i=2,3 do
  local count = redis.call('INCR', KEYS[i])
  local ttl = redis.call('PTTL', KEYS[i])
  local window = tonumber(ARGV[(i-2)*2+2])
  if count == 1 or ttl < 0 then redis.call('PEXPIRE', KEYS[i], window); ttl = window end
  if count > tonumber(ARGV[(i-2)*2+3]) then allowed = 0; wait = math.max(wait, ttl) end
end
redis.call('SET', KEYS[1], tostring(allowed), 'PX', ARGV[1])
return {allowed, wait}
`);
export type MessagingSendReservation = {
  /** Scoped, hashed identifiers; no content or bearer secrets. Private abuse-admission state. */
  readonly actor: string;
  readonly channel: string;
  readonly request: string;
  readonly actorRule: RateLimitRule;
  readonly channelRule: RateLimitRule;
};
export function createMessagingReservation({
  client,
  namespace,
  reportFailure,
}: {
  readonly client: RedisTransport;
  readonly namespace: string;
  readonly reportFailure: (operation: string) => void;
}) {
  return {
    async reserveMessagingSend(input: MessagingSendReservation) {
      const rules = [input.actorRule, input.channelRule];
      if (
        rules.some(
          ({ max, windowSeconds }) =>
            !Number.isSafeInteger(max) ||
            max < 1 ||
            !Number.isSafeInteger(windowSeconds) ||
            windowSeconds < 1 ||
            windowSeconds > 86400,
        )
      )
        throw new Error('Invalid messaging reservation rule');
      const keys = [
        redisKey(
          namespace,
          'messaging-reservation',
          input.actor,
          input.channel,
          input.request,
        ),
        redisKey(namespace, 'rl', 'messaging-send', input.actor),
        redisKey(namespace, 'rl', 'messaging-send', input.actor, input.channel),
      ];
      try {
        await client.connect();
        const [allowed, wait] = (await client.send('EVAL', [
          reservationScript,
          '3',
          ...keys,
          '30000',
          ...rules.flatMap(({ max, windowSeconds }) => [
            String(windowSeconds * 1000),
            String(max),
          ]),
        ])) as [number, number];
        if (
          (allowed !== 0 && allowed !== 1) ||
          !Number.isFinite(wait) ||
          wait < 0
        )
          throw new Error('Invalid messaging reservation result');
        return {
          allowed: allowed === 1,
          retryAfterSeconds: allowed === 1 ? 0 : Math.ceil(wait / 1000),
        };
      } catch (error) {
        reportFailure('reserveMessagingSend');
        throw error;
      }
    },
  };
}
