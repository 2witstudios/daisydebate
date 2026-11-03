import { idSchema } from '@daisy/protocol';
import { createScriptRunner } from './presence-scripts';
import { redisKey } from './redis-key';
import { reportedOperation } from './reported-operation';
import { defineScript } from './script-registry';
import type { RedisTransport } from './transport';

const pulseScript = defineScript(`
redis.call('PFADD', KEYS[1], ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return 1
`);

/**
 * How many tabs watched a Round in a time bucket, as a HyperLogLog (SPECT-1.4).
 * The sketch cannot give a token back, and nothing else is kept: no account, no
 * address, no list of viewers. A key expires on its own and a lost one is a
 * missing count, which drives nothing.
 */
export function createViewerCountOperations(input: {
  readonly client: RedisTransport;
  readonly namespace: string;
  readonly reportFailure: (operation: string) => void;
}) {
  const key = (roundId: string, bucket: number) => {
    if (!Number.isSafeInteger(bucket) || bucket < 0)
      throw new Error('Invalid viewer bucket');
    return redisKey(
      input.namespace,
      'viewers',
      idSchema.parse(roundId),
      String(bucket),
    );
  };
  const reported = reportedOperation(input);
  const runScript = createScriptRunner(input.client);
  return {
    recordViewerPulse: (pulse: {
      readonly roundId: string;
      readonly bucket: number;
      readonly token: string;
      readonly ttlMs: number;
    }) => {
      const scopedKey = key(pulse.roundId, pulse.bucket);
      const token = idSchema.parse(pulse.token);
      return reported('recordViewerPulse', async () => {
        await runScript(pulseScript, 1, [
          scopedKey,
          token,
          String(pulse.ttlMs),
        ]);
      });
    },
    readViewerCount: (roundId: string, bucket: number) => {
      const scopedKey = key(roundId, bucket);
      return reported('readViewerCount', async () =>
        Number(await input.client.send('PFCOUNT', [scopedKey])),
      );
    },
  };
}
