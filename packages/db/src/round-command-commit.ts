import type { DecisionReleasePolicy } from '@daisy/protocol/round-decision-release';
import type { RoundCommandReceipt } from '@daisy/protocol/round-command';
import type { RoundProjection } from '@daisy/protocol/runtime';
import {
  insertCommandRow,
  lockedRoundVersion,
  writeProjectionWithPhaseSignal,
} from './round-projection-writer';
import { writeSpeakingProjection } from './round-speaking-writer';
import type { RoundCommandType } from './schema/round-commands';
import type { Tx } from './tx';

/**
 * Writes one decided command under the Round's lock: its projection, its
 * durable row and the speaking projection, as one revision.
 */
export async function commitRoundCommand(
  tx: Tx,
  input: {
    readonly roundId: string;
    readonly decisionRelease?: DecisionReleasePolicy | undefined;
    readonly current: Awaited<ReturnType<typeof lockedRoundVersion>>;
    readonly projection: RoundProjection;
    readonly now: string;
    readonly command: {
      readonly commandId: string;
      readonly actorId: string | null;
      readonly serviceId: string | null;
      readonly type: RoundCommandType;
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
    input.decisionRelease,
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
