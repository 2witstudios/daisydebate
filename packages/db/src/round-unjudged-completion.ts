import { createAppError, isAppError } from '@daisy/errors';
import type { RoundUnjudgedReceipt } from '@daisy/protocol';
import { and, eq, sql } from 'drizzle-orm';
import type { BoundedTransaction } from './bounded-transaction';
import type { BoundedTransactionContext } from './transaction-context';
import { fenceAttendance } from './attendance-facts';
import { assertRoundAttendanceSettled } from './attendance-settlement';
import {
  executeLockedRoundTick,
  type LockedRoundTickInput,
} from './round-clock-transaction';
import { hydrateRoundRows } from './round-hydration';
import { requireCurrentWeb } from './round-service-authority';
import { readTranscriptFreeze } from './frozen-transcript';
import { sampleRoundExecutionTime } from './round-execution-time';
import {
  insertCommandRow,
  lockedRoundVersion,
  writeProjectionWithPhaseSignal,
} from './round-projection-writer';
import { writeSpeakingProjection } from './round-speaking-writer';
import { roundCommands } from './schema/round-commands';
import {
  requireCompletionProjection,
  requireUnjudgedFacts,
  requireUnjudgedRequest,
  requireUnjudgedRound,
  requireUnjudgedTerminal,
  unjudgedDigest,
  unjudgedReceipt,
  validateUnjudgedReceipt,
  type UnjudgedDurableFacts,
} from './round-unjudged-decisions';

type Request = LockedRoundTickInput & {
  readonly instanceId: string;
  readonly commandId: string;
  readonly freezeRevision: number;
  readonly buildCompletion: LockedRoundTickInput['buildProjection'];
};
async function replay(
  tx: BoundedTransactionContext,
  input: Request,
  digest: string,
  sameCommand: boolean,
) {
  const [row] = await tx
    .select()
    .from(roundCommands)
    .where(
      sameCommand
        ? eq(roundCommands.commandId, input.commandId)
        : and(
            eq(roundCommands.roundId, input.roundId),
            eq(roundCommands.type, 'complete'),
          ),
    )
    .limit(1);
  if (!row) return null;
  const receipt = validateUnjudgedReceipt(row, input, digest);
  requireUnjudgedTerminal(await lockedRoundVersion(tx, input.roundId));
  await requireCurrentWeb(tx, input.instanceId);
  return { ...receipt, replayed: true };
}

async function readCompletionFacts(
  tx: BoundedTransactionContext,
  input: Request,
  facts: Awaited<ReturnType<typeof fenceAttendance>>,
) {
  await requireCurrentWeb(tx, input.instanceId, true);
  await executeLockedRoundTick(tx, input);
  const round = await hydrateRoundRows(tx, input.roundId);
  const freeze = await readTranscriptFreeze(tx, input.roundId);
  const [durable] =
    await tx.execute(sql`select ladder_id,final_segment_ended_at,transcript_admission_cutoff,
    exists(select 1 from ballots where round_id=${input.roundId}) as ballots,
    exists(select 1 from rating_changes where round_id=${input.roundId}) as ratings
    from rounds where id=${input.roundId}`);
  const now = await sampleRoundExecutionTime(tx);
  requireUnjudgedRound(round);
  const frozen = requireUnjudgedFacts({
    freezeRevision: input.freezeRevision,
    freeze,
    seats: facts.seats,
    durable: durable as UnjudgedDurableFacts | undefined,
  });
  await assertRoundAttendanceSettled(tx, { roundId: input.roundId, now });
  return { round, freeze: frozen, now };
}

async function complete(tx: BoundedTransactionContext, input: Request) {
  await requireCurrentWeb(tx, input.instanceId);
  const digest = unjudgedDigest(input);
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${input.commandId},59002))`,
  );
  const prior = await replay(tx, input, digest, true);
  if (prior) return prior;
  let facts: Awaited<ReturnType<typeof fenceAttendance>>;
  try {
    facts = await fenceAttendance(tx, input.roundId, input.commandId, null);
  } catch (error) {
    if (
      isAppError(error) &&
      error.code === 'CONFLICT' &&
      error.message === 'attendance-terminal'
    ) {
      const terminal = await replay(tx, input, digest, false);
      if (terminal) return terminal;
    }
    throw error;
  }
  const { round, freeze, now } = await readCompletionFacts(tx, input, facts);
  const projection = input.buildCompletion({ round, now });
  requireCompletionProjection(projection);
  const current = await lockedRoundVersion(tx, input.roundId);
  await requireCurrentWeb(tx, input.instanceId);
  const changed = await writeProjectionWithPhaseSignal(
    tx,
    input.roundId,
    current,
    projection,
    now,
  );
  if (!changed) throw createAppError('CONFLICT', 'unjudged-projection');
  const receipt = unjudgedReceipt({
    commandId: input.commandId,
    roundId: input.roundId,
    freezeRevision: freeze.revision,
    resultingVersion: current.version + 1,
  });
  await insertCommandRow(
    tx,
    input.roundId,
    {
      commandId: input.commandId,
      actorId: null,
      serviceId: `round-finalization:${input.instanceId}`,
      type: 'complete',
      payloadDigest: digest,
      result: receipt,
    },
    receipt.resultingVersion,
  );
  await writeSpeakingProjection(tx, {
    roundId: input.roundId,
    projection,
    resultingVersion: receipt.resultingVersion,
    commandId: input.commandId,
  });
  await requireCurrentWeb(tx, input.instanceId);
  return receipt;
}

export function roundUnjudgedCompletionOperations(run: BoundedTransaction) {
  return {
    completeUnjudgedRound(input: Request): Promise<RoundUnjudgedReceipt> {
      requireUnjudgedRequest(input);
      return run((tx) => complete(tx, input));
    },
  };
}
