import type { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { finishedOrBlockedBehind } from '../src/testing';
import type { captureSchemaStream } from './capture-schema.test-support';
import { rejectedBy } from './constraint-helpers';

/** Observe a write queued behind the holder's open transaction, then release it. */
export async function writeBehindHolder(
  client: SQL,
  held: SQL,
  holderPid: number,
  writing: Promise<unknown>,
) {
  const outcome = rejectedBy(() => writing);
  const blocked = await finishedOrBlockedBehind(writing, client, holderPid, {
    now: performance.now,
  });
  await held`commit`;
  return { blocked, refusal: await outcome };
}

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
