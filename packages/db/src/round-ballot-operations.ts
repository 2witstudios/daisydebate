import { roundBallotReads } from './round-ballot-reads';
import { assertRoundAttendanceSettled } from './attendance-settlement';
import { createAppError } from '@daisy/errors';
import {
  roundBallotEnvelopeSchema,
  roundBallotReceiptSchema,
  type RoundBallotEnvelope,
  type RoundBallotReceipt,
  type RoundCommandPrincipal,
  type RoundCommandAuthority,
  type RoundProjection,
} from '@daisy/protocol';
import { eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import {
  readLockedFrozenRoundTranscript,
  type FrozenRoundTranscript,
} from './frozen-transcript';
import { instrumented, type DatabaseEventSink } from './instrumented';
import {
  lockedRoundVersion,
  insertCommandRow,
  writeProjectionWithPhaseSignal,
} from './round-projection-writer';
import { writeSpeakingProjection } from './round-speaking-writer';
import {
  fenceRoundWrite,
  readRoundWriteContext,
  requireHumanRoundPrincipal,
  roundPrincipalColumns,
  type RoundWriteTransaction,
} from './round-write-authority';
import type { RoundHydration } from './round-hydration';
import { ballots } from './schema/ballots';
import { rounds } from './schema/rounds';
import { roundCommands } from './schema/round-commands';
import {
  requireCommandInput,
  requireFencedParticipants,
  requireSameCommand,
} from './round-command-replay';
import {
  ballotReceipt,
  requireBallotAdmission,
  requireFrozenRevision,
  requireJudgingRun,
} from './round-ballot-decisions';

type RoundBallotLeaseContext = {
  readonly roundId: string;
  readonly judgeParticipantId: string;
  readonly freezeRevision: number;
  readonly now: string;
};
export type LockedRoundBallotContext = {
  readonly round: RoundHydration;
  readonly authority: RoundCommandAuthority;
  readonly runKind: string | null;
  readonly frozen: FrozenRoundTranscript;
  readonly now: string;
};
export type LockedRoundBallotInput = {
  readonly roundId: string;
  readonly principal: RoundCommandPrincipal;
  readonly envelope: RoundBallotEnvelope;
  readonly payloadDigest: string;
  readonly nextBallotId: () => string;
  /** Fresh authority on new writes and replay. */
  readonly authorize: (context: LockedRoundBallotContext) => void;
  /** Required for bot results; called after locks and on replay, inside this transaction. */
  readonly assertLease?: (
    tx: RoundWriteTransaction,
    context: RoundBallotLeaseContext,
  ) => Promise<void>;
  /** Pure engine callback. Null means other required judges have not submitted yet. */
  readonly buildProjection: (
    context: LockedRoundBallotContext & {
      readonly ballots: readonly (typeof ballots.$inferSelect)[];
    },
  ) => RoundProjection | null;
};

async function replayBallot(
  tx: RoundWriteTransaction,
  input: LockedRoundBallotInput,
) {
  const [previous] = await tx
    .select()
    .from(roundCommands)
    .where(eq(roundCommands.commandId, input.envelope.commandId));
  if (!previous) return null;
  requireSameCommand(previous, {
    ...roundPrincipalColumns(input.principal),
    roundId: input.roundId,
    payloadDigest: input.payloadDigest,
    type: 'submit_ballot',
  });
  return roundBallotReceiptSchema.parse(previous.result);
}
async function lockedBallotContext(
  tx: RoundWriteTransaction,
  input: LockedRoundBallotInput,
) {
  const scope = {
    ...input,
    commandId: input.envelope.commandId,
  };
  const fenced = await fenceRoundWrite(tx, scope);
  const current = await lockedRoundVersion(tx, input.roundId);
  const fresh = await readRoundWriteContext(
    tx,
    scope,
    fenced.accounts,
    'ballot',
  );
  requireFencedParticipants(fresh.round.participants, fenced.actorIds);
  requireHumanRoundPrincipal(input.principal, fenced.accounts);
  const frozen = requireFrozenRevision(
    await readLockedFrozenRoundTranscript(tx, input.roundId),
    input.envelope.freezeRevision,
  );
  const context = { ...fresh, frozen };
  input.authorize(context);
  requireJudgingRun(
    { ...input, leased: input.assertLease !== undefined },
    fresh,
  );
  if (input.assertLease)
    await input.assertLease(tx, {
      roundId: input.roundId,
      judgeParticipantId: input.envelope.judgeParticipantId,
      freezeRevision: frozen.revision,
      now: fresh.now,
    });
  return { current, context };
}

/** Caller supplies a genuinely active transaction; this helper never begins or commits one. */
export async function executeLockedRoundBallot(
  tx: RoundWriteTransaction,
  input: LockedRoundBallotInput,
): Promise<RoundBallotReceipt> {
  requireCommandInput(input, roundBallotEnvelopeSchema);
  const { current, context } = await lockedBallotContext(tx, input);
  const fresh = context;
  const replay = await replayBallot(tx, input);
  if (replay) return replay;
  // The persisted ballot deadline is the cutoff by the database clock (DEC-207).
  const [window] = await tx
    .select({ deadline: rounds.ballotDeadlineAt })
    .from(rounds)
    .where(eq(rounds.id, input.roundId));
  const existing = await tx
    .select()
    .from(ballots)
    .where(eq(ballots.roundId, input.roundId));
  requireBallotAdmission({
    version: current.version,
    expectedVersion: input.envelope.expectedVersion,
    round: fresh.round,
    submittedJudgeIds: existing.map((b) => b.judgeParticipantId),
    judgeParticipantId: input.envelope.judgeParticipantId,
    now: fresh.now,
    ballotDeadlineAt: window?.deadline ?? null,
  });
  const stored = await insertFrozenBallot(tx, input, context);
  const ballotId = stored.id;
  const projection = input.buildProjection({
    ...context,
    ballots: [...existing, stored],
  });
  return persistBallotResult(tx, input, context, current, ballotId, projection);
}
async function persistBallotResult(
  tx: RoundWriteTransaction,
  input: LockedRoundBallotInput,
  context: LockedRoundBallotContext,
  current: Awaited<ReturnType<typeof lockedRoundVersion>>,
  ballotId: string,
  projection: RoundProjection | null,
): Promise<RoundBallotReceipt> {
  if (projection?.round?.status === 'completed')
    await assertRoundAttendanceSettled(tx, {
      roundId: input.roundId,
      now: context.now,
    });
  const changed = projection
    ? await writeProjectionWithPhaseSignal(
        tx,
        input.roundId,
        current,
        projection,
        context.now,
      )
    : false;
  const receipt = ballotReceipt({
    commandId: input.envelope.commandId,
    roundId: input.roundId,
    ballotId,
    judgeParticipantId: input.envelope.judgeParticipantId,
    freezeRevision: context.frozen.revision,
    version: current.version,
    changed,
    outcome: projection?.round?.outcome,
  });
  const { resultingVersion } = receipt;
  await insertCommandRow(
    tx,
    input.roundId,
    {
      ...roundPrincipalColumns(input.principal),
      commandId: input.envelope.commandId,
      type: 'submit_ballot',
      payloadDigest: input.payloadDigest,
      result: { ...receipt },
    },
    resultingVersion,
  );
  if (projection)
    await writeSpeakingProjection(tx, {
      roundId: input.roundId,
      projection,
      resultingVersion,
      commandId: input.envelope.commandId,
    });
  return receipt;
}

async function insertFrozenBallot(
  tx: RoundWriteTransaction,
  input: LockedRoundBallotInput,
  context: LockedRoundBallotContext,
) {
  const ballotId = input.nextBallotId();
  const body = input.envelope.ballot;
  const [stored] = await tx
    .insert(ballots)
    .values({
      id: ballotId,
      roundId: input.roundId,
      judgeParticipantId: input.envelope.judgeParticipantId,
      freezeRevision: context.frozen.revision,
      rubricVersion: body.rubricVersion,
      winner: body.winner,
      scores: body.scores,
      reason: body.reason,
      feedback: body.feedback,
      citations: body.citations ?? null,
      status: 'submitted',
      submittedAt: new Date(context.now),
    })
    .returning();
  if (!stored) throw createAppError('INVARIANT');
  return stored;
}
export const roundBallotOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  ...roundBallotReads({ database }),
  executeRoundBallot: (input: LockedRoundBallotInput) =>
    instrumented(eventSink, 'executeRoundBallot', () =>
      database.transaction((tx) => executeLockedRoundBallot(tx, input)),
    ),
});
