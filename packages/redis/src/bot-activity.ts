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
/** Expendable PCM only; no second client, durable transcript, bearer or competitive authority. */
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
  const guarded = async <T>(
    operation: string,
    work: () => Promise<T>,
  ): Promise<T> => {
    try {
      await input.client.connect();
      await requireMemoryOnly(input.client);
      return await work();
    } catch (error) {
      input.reportFailure(operation);
      throw error;
    }
  };
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
