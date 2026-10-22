import { CryptoHasher } from 'bun';
import { createAppError, isAppError } from '@daisy/errors';
import { idSchema, roundUnjudgedReceiptSchema } from '@daisy/protocol';
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
import { requireCurrentWeb } from './round-maintenance';
import { readTranscriptFreeze } from './frozen-transcript';
import { sampleRoundExecutionTime } from './round-execution-time';
import {
  insertCommandRow,
  lockedRoundVersion,
  writeProjectionWithPhaseSignal,
} from './round-projection-writer';
import { writeSpeakingProjection } from './round-speaking-writer';
import { roundCommands } from './schema/round-commands';

type Request = LockedRoundTickInput & {
  readonly instanceId: string;
  readonly commandId: string;
  readonly freezeRevision: number;
  readonly buildCompletion: LockedRoundTickInput['buildProjection'];
};
const digestOf = (input: Request) =>
  new CryptoHasher('sha3-256')
    .update(
      JSON.stringify({
        purpose: 'complete-unjudged',
        roundId: input.roundId,
        freezeRevision: input.freezeRevision,
      }),
    )
    .digest('hex');

function requireReceiptCommand(
  row: typeof roundCommands.$inferSelect,
  input: Request,
  digest: string,
) {
  if (
    row.roundId !== input.roundId ||
    row.type !== 'complete' ||
    row.actorId !== null ||
    !row.serviceId?.startsWith('round-finalization:') ||
    row.payloadDigest !== digest
  )
    throw createAppError('CONFLICT', 'unjudged-receipt-conflict');
}
function validateReceipt(
  row: typeof roundCommands.$inferSelect,
  input: Request,
  digest: string,
) {
  requireReceiptCommand(row, input, digest);
  const receipt = roundUnjudgedReceiptSchema.parse(row.result);
  if (
    receipt.roundId !== input.roundId ||
    receipt.freezeRevision !== input.freezeRevision ||
    receipt.commandId !== row.commandId ||
    receipt.resultingVersion !== row.resultingVersion
  )
    throw createAppError('CONFLICT', 'unjudged-receipt-conflict');
  return receipt;
}

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
  const receipt = validateReceipt(row, input, digest);
  const terminal = await lockedRoundVersion(tx, input.roundId);
  if (terminal.status !== 'completed' || terminal.outcome !== null)
    throw createAppError('CONFLICT', 'unjudged-receipt-conflict');
  await requireCurrentWeb(tx, input.instanceId);
  return { ...receipt, replayed: true };
}

function requireUnjudgedRound(
  round: Awaited<ReturnType<typeof hydrateRoundRows>>,
): asserts round is NonNullable<typeof round> {
  if (
    !round ||
    round.competitionType !== 'casual' ||
    round.rules.seats.judge !== 0 ||
    round.segments.some((p) => p.endedAt === null) ||
    round.participants.some((p) => p.role === 'judge')
  )
    throw createAppError('CONFLICT', 'unjudged-ineligible');
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
  if (!freeze || freeze.revision !== input.freezeRevision)
    throw createAppError('CONFLICT', 'unjudged-ineligible');
  if (facts.seats.some((p) => !p.eligible))
    throw createAppError('CONFLICT', 'unjudged-ineligible');
  if (
    !durable ||
    durable.ladder_id !== null ||
    !durable.final_segment_ended_at ||
    !durable.transcript_admission_cutoff ||
    durable.ballots ||
    durable.ratings
  )
    throw createAppError('CONFLICT', 'unjudged-ineligible');
  await assertRoundAttendanceSettled(tx, { roundId: input.roundId, now });
  return { round, freeze, now };
}

function requireCompletionProjection(
  projection: ReturnType<Request['buildCompletion']>,
) {
  if (
    projection.round?.status !== 'completed' ||
    projection.round.outcome !== null ||
    projection.segmentInserts.length ||
    projection.segmentCloses.length
  )
    throw createAppError('CONFLICT', 'unjudged-projection');
}
async function complete(tx: BoundedTransactionContext, input: Request) {
  await requireCurrentWeb(tx, input.instanceId);
  const digest = digestOf(input);
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
  const receipt = roundUnjudgedReceiptSchema.parse({
    version: 1,
    commandId: input.commandId,
    roundId: input.roundId,
    freezeRevision: freeze.revision,
    resultingVersion: current.version + 1,
    status: 'completed',
    outcome: null,
    replayed: false,
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
    completeUnjudgedRound(input: Request) {
      if (
        ![input.instanceId, input.commandId, input.roundId].every(
          (id) => idSchema.safeParse(id).success,
        ) ||
        !Number.isSafeInteger(input.freezeRevision) ||
        input.freezeRevision < 1
      )
        throw createAppError('VALIDATION');
      return run((tx) => complete(tx, input));
    },
  };
}
