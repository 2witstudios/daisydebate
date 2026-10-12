import { idSchema } from '@daisy/protocol';
import { redisKey } from './redis-key';
import { defineScript } from './script-registry';
import {
  createObservationRunner,
  segment,
  ttl,
  type ObservationRunnerInput,
} from './observation-runner';

const claimScript = defineScript(`
local owner = redis.call('GET', KEYS[1])
if owner and owner ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
return 1
`);
/** The cursor moves only from the value the current owner read. */
const advanceScript = defineScript(`
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
local cursor = redis.call('GET', KEYS[2])
if ARGV[2] == '' then
 if cursor then return 0 end
elseif cursor ~= ARGV[2] then return 0 end
redis.call('SET', KEYS[2], ARGV[3], 'PX', ARGV[4])
return 1
`);
/** Publication stays a namespaced script like every other observation write. */
const publishControlScript = defineScript(`
redis.call('PUBLISH', KEYS[1], ARGV[1])
return 1
`);
const cursorPattern = /^\d{1,20}:\d{1,20}$/;
const validCursor = (value: string) => {
  if (!cursorPattern.test(value)) throw new Error('Invalid relay cursor');
  return value;
};
export type ObservationControlMessage = {
  readonly kind: 'session';
  readonly actorId: string;
  readonly sessionId: string | null;
};
/** Untrusted channel payloads become a fence, or nothing. */
export function parseObservationControl(
  raw: string,
): ObservationControlMessage | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const { kind, actorId, sessionId, ...rest } = value as Record<
      string,
      unknown
    >;
    return kind === 'session' &&
      Object.keys(rest).length === 0 &&
      idSchema.safeParse(actorId).success &&
      (sessionId === null || idSchema.safeParse(sessionId).success)
      ? {
          kind,
          actorId: actorId as string,
          sessionId: sessionId as string | null,
        }
      : null;
  } catch {
    return null;
  }
}
/** Channel carrying expendable fences; never content, never a grant. */
export const observationControlChannel = (namespace: string) =>
  redisKey(namespace, 'observation', 'control');

/** Elected relay ownership, its shared cursor and control publication. */
export function createObservationRelayOperations(
  input: ObservationRunnerInput,
) {
  const { script, client, namespace } = createObservationRunner(input);
  const owner = redisKey(namespace, 'observation', 'relay', 'owner');
  const cursor = redisKey(namespace, 'observation', 'relay', 'cursor');
  return {
    async claimObservationRelay(token: string, ttlMs: number) {
      return (
        Number(
          await script(
            'claimObservationRelay',
            claimScript,
            [owner],
            [segment(token), ttl(ttlMs, 5000)],
          ),
        ) === 1
      );
    },
    async readObservationRelayCursor(): Promise<string | null> {
      await client.connect();
      const value = await client.get(cursor);
      return value === null ? null : validCursor(value);
    },
    async advanceObservationRelayCursor(
      token: string,
      from: string | null,
      to: string,
    ) {
      return (
        Number(
          await script(
            'advanceObservationRelayCursor',
            advanceScript,
            [owner, cursor],
            [
              segment(token),
              from === null ? '' : validCursor(from),
              validCursor(to),
              String(24 * 60 * 60 * 1000),
            ],
          ),
        ) === 1
      );
    },
    async publishObservationControl(control: ObservationControlMessage) {
      await script(
        'publishObservationControl',
        publishControlScript,
        [observationControlChannel(namespace)],
        [
          JSON.stringify({
            kind: 'session',
            actorId: idSchema.parse(control.actorId),
            sessionId:
              control.sessionId === null
                ? null
                : idSchema.parse(control.sessionId),
          }),
        ],
      );
    },
  };
}
