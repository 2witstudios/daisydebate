import type { RedisTransport } from './transport';
import { redisKey } from './redis-key';

/**
 * Replay protection for the signed operator API (ADR 0079): a verified
 * request's nonce is admitted once, under the authenticated service and
 * key, for the signature window's lifetime. Admission is `SET NX EX`, so a
 * replay finds the key and is refused; an outage throws, and the caller
 * fails closed.
 */
export function createOperatorNonceOperations({
  client,
  namespace,
  reportFailure,
}: {
  readonly client: RedisTransport;
  readonly namespace: string;
  readonly reportFailure: (operation: string) => void;
}) {
  return {
    /** True the first time this service and key present the nonce, false on any replay. */
    async admitOperatorNonce(input: {
      readonly serviceId: string;
      readonly keyId: string;
      readonly nonce: string;
      readonly ttlSeconds: number;
    }): Promise<boolean> {
      if (!Number.isSafeInteger(input.ttlSeconds) || input.ttlSeconds < 1)
        throw new Error('TTL must be a positive integer');
      const key = redisKey(
        namespace,
        'operator-nonce',
        input.serviceId,
        input.keyId,
        input.nonce,
      );
      try {
        await client.connect();
        const reply = await client.send('SET', [
          key,
          '1',
          'NX',
          'EX',
          String(input.ttlSeconds),
        ]);
        return reply === 'OK';
      } catch (error) {
        reportFailure('admitOperatorNonce');
        throw error;
      }
    },
  };
}
