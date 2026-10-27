import type { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import type { captureSchemaStream } from './capture-schema.test-support';

export const insertFrozenProofLine = (
  client: Pick<SQL, 'unsafe'>,
  stream: Awaited<ReturnType<typeof captureSchemaStream>>,
  sequence = 0,
  id = createId(),
) =>
  client.unsafe(
    'insert into utterances(id,round_id,segment_id,round_participant_id,sequence,text) values($1,$2,$3,$4,$5,$6)',
    [
      id,
      stream.roundId,
      stream.segmentId,
      stream.seat.id,
      sequence,
      'Frozen proof',
    ],
  );
