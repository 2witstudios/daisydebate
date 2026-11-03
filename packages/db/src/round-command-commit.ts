import type { RoundCommandReceipt, RoundProjection } from '@daisy/protocol';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import {
  insertCommandRow,
  lockedRoundVersion,
  writeProjectionWithPhaseSignal,
} from './round-projection-writer';
import { writeSpeakingProjection } from './round-speaking-writer';

type Tx = Pick<BunSQLDatabase, 'select' | 'update' | 'insert' | 'execute'>;

/**
 * Writes one decided command under the Round's lock: its projection, its
 * durable row and the speaking projection, as one revision.
 */
export async function commitRoundCommand(
  tx: Tx,
  input: {
    readonly roundId: string;
    readonly current: Awaited<ReturnType<typeof lockedRoundVersion>>;
    readonly projection: RoundProjection;
    readonly now: string;
    readonly command: {
      readonly commandId: string;
      readonly actorId: string | null;
      readonly serviceId: string | null;
      readonly type: string;
      readonly payloadDigest: string;
    };
  },
): Promise<RoundCommandReceipt> {
  const { roundId, current, projection, command } = input;
  const changed = await writeProjectionWithPhaseSignal(
    tx,
    roundId,
    current,
    projection,
    input.now,
  );
  const resultingVersion = current.version + (changed ? 1 : 0);
  const receipt = {
    commandId: command.commandId,
    roundId,
    resultingVersion,
    replayed: false,
  };
  await insertCommandRow(
    tx,
    roundId,
    { ...command, result: { ...receipt } },
    resultingVersion,
    { before: current.status, projection },
  );
  await writeSpeakingProjection(tx, {
    roundId,
    projection,
    resultingVersion,
    commandId: command.commandId,
  });
  return receipt;
}
