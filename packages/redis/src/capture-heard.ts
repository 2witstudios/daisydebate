import { idSchema } from '@daisy/protocol';
import type { RedisTransport } from './transport';
import { redisKey } from './redis-key';

/**
 * Capture's report that it hears a seat's track (DEC-226, ISSUE-514-r2):
 * identifiers only, no audio or authority, expiring in 30 s. Capture writes
 * it; a bot reads it as a named input and credits speech only once its own
 * seat is reported here.
 */
export function createCaptureHeardOperations(input: {
  readonly client: RedisTransport;
  readonly namespace: string;
  readonly reportFailure: (operation: string) => void;
}) {
  const key = (roundId: string, trackId: string) => {
    if (!idSchema.safeParse(roundId).success)
      throw new Error('Invalid heard track scope');
    // The key segment pattern bounds the track id.
    return redisKey(input.namespace, 'captureheard', roundId, trackId);
  };
  const reported = async <T>(
    operation: string,
    work: () => Promise<T>,
  ): Promise<T> => {
    try {
      await input.client.connect();
      return await work();
    } catch (error) {
      input.reportFailure(operation);
      throw error;
    }
  };
  return {
    writeCaptureHeard: (heard: {
      readonly roundId: string;
      readonly trackId: string;
      readonly seat: string;
    }) => {
      if (!idSchema.safeParse(heard.seat).success)
        throw new Error('Invalid heard seat');
      const scopedKey = key(heard.roundId, heard.trackId);
      return reported('writeCaptureHeard', async () => {
        await input.client.send('SET', [scopedKey, heard.seat, 'PX', '30000']);
      });
    },
    readCaptureHeard: (roundId: string, trackId: string) => {
      const scopedKey = key(roundId, trackId);
      return reported('readCaptureHeard', async () => {
        const seat = await input.client.get(scopedKey);
        return seat !== null && idSchema.safeParse(seat).success ? seat : null;
      });
    },
  };
}
