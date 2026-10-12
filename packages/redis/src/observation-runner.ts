import { createHash } from 'node:crypto';
import {
  observationBaseKey,
  observationResourceKey,
  type ObservationBase,
  type ObservationResource,
} from '@daisy/protocol';
import { redisKey, redisSegmentPattern } from './redis-key';
import type { RedisTransport } from './transport';

export const segment = (value: string) => {
  if (!redisSegmentPattern.test(value))
    throw new Error('Invalid observation fence');
  return value;
};
export const ttl = (value: number, max = 60000) => {
  if (!Number.isSafeInteger(value) || value < 1 || value > max)
    throw new Error('Invalid observation TTL');
  return String(value);
};
export const baseDigest = (base: ObservationBase) =>
  createHash('sha3-256').update(observationBaseKey(base)).digest('hex');
export type ObservationRunnerInput = {
  readonly client: RedisTransport;
  readonly namespace: string;
  readonly reportFailure: (operation: string) => void;
};
/** Shared namespaced keys and failure-reporting EVAL for observation operations. */
export function createObservationRunner({
  client,
  namespace,
  reportFailure,
}: ObservationRunnerInput) {
  const sentinel = redisKey(namespace, 'observation', 'incarnation');
  const keys = (resource: ObservationResource) => {
    const key = observationResourceKey(resource);
    return [
      sentinel,
      redisKey(namespace, 'observation', key, 'owner'),
      redisKey(namespace, 'observation', key, 'guard'),
      redisKey(namespace, 'observation', key, 'data'),
      redisKey(namespace, 'observation', key, 'hint'),
    ];
  };
  async function script(
    operation: string,
    source: string,
    names: string[],
    args: string[],
  ) {
    try {
      await client.connect();
      return await client.send('EVAL', [
        source,
        String(names.length),
        ...names,
        ...args,
      ]);
    } catch (error) {
      reportFailure(operation);
      throw error;
    }
  }
  return { sentinel, keys, script, client, namespace };
}
