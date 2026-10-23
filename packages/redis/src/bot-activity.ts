import { botActivityBatchSchema } from '@daisy/protocol/bot-activity';
import { idSchema } from '@daisy/protocol';
import type { RedisTransport } from './transport';
import { redisKey } from './redis-key';
const MAX_BYTES = 65536;
function encodedWithinLimit(value: string) {
  if (new TextEncoder().encode(value).length > MAX_BYTES)
    throw new Error('Bot activity payload exceeds limit');
  return value;
}
async function requireMemoryOnly(client: RedisTransport) {
  const reply = await client.send('CONFIG', ['GET', 'appendonly', 'save']);
  if (
    !reply ||
    typeof reply !== 'object' ||
    Array.isArray(reply) ||
    Object.keys(reply).length !== 2 ||
    !('appendonly' in reply) ||
    !('save' in reply) ||
    reply.appendonly !== 'no' ||
    reply.save !== ''
  )
    throw new Error('Memory-only Redis capability required');
}
/**
 * Expendable PCM only; no second client, durable transcript, bearer or competitive authority.
 * The key holds live human speech (personal/private) for its 1 s expiry; classified in
 * docs/operations/privacy.md, "Bot activity relay declaration" (ISSUE-500).
 */
export function createBotActivityOperations(input: {
  readonly client: RedisTransport;
  readonly namespace: string;
  readonly reportFailure: (operation: string) => void;
}) {
  const key = (roundId: string, participantId: string) => {
    if (
      ![roundId, participantId].every(
        (value) => idSchema.safeParse(value).success,
      )
    )
      throw new Error('Invalid bot activity scope');
    return redisKey(input.namespace, 'botactivity', roundId, participantId);
  };
  const heardKey = (roundId: string, trackId: string) => {
    if (!idSchema.safeParse(roundId).success)
      throw new Error('Invalid heard track scope');
    // The key segment pattern bounds the track id.
    return redisKey(input.namespace, 'botheard', roundId, trackId);
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
  const guarded = <T>(operation: string, work: () => Promise<T>) =>
    reported(operation, async () => {
      await requireMemoryOnly(input.client);
      return work();
    });
  return {
    writeBotActivity: (value: unknown) => {
      const serialized = encodedWithinLimit(JSON.stringify(value));
      const batch = botActivityBatchSchema.parse(value);
      return guarded('writeBotActivity', async () => {
        await input.client.send('SET', [
          key(batch.roundId, batch.roundParticipantId),
          serialized,
          'PX',
          '1000',
        ]);
      });
    },
    /**
     * Capture hears a bot seat's track (ISSUE-514-r2): identifiers only, no
     * authority. The bot credits speech only once it reads its own seat here.
     */
    writeCaptureHeard: (heard: {
      readonly roundId: string;
      readonly trackId: string;
      readonly seat: string;
    }) => {
      if (!idSchema.safeParse(heard.seat).success)
        throw new Error('Invalid heard seat');
      const scopedKey = heardKey(heard.roundId, heard.trackId);
      return reported('writeCaptureHeard', async () => {
        await input.client.send('SET', [scopedKey, heard.seat, 'PX', '30000']);
      });
    },
    readCaptureHeard: (roundId: string, trackId: string) => {
      const scopedKey = heardKey(roundId, trackId);
      return reported('readCaptureHeard', async () => {
        const seat = await input.client.get(scopedKey);
        return seat !== null && idSchema.safeParse(seat).success ? seat : null;
      });
    },
    readBotActivity: (roundId: string, participantId: string) => {
      const scopedKey = key(roundId, participantId);
      return guarded('readBotActivity', async () => {
        const serialized = await input.client.get(scopedKey);
        if (serialized === null) return null;
        const batch = botActivityBatchSchema.parse(
          JSON.parse(encodedWithinLimit(serialized)),
        );
        if (
          batch.roundId !== roundId ||
          batch.roundParticipantId !== participantId
        )
          throw new Error('Bot activity scope changed');
        return batch;
      });
    },
  };
}
