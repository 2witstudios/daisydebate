import {
  ballotTextScreeningSchema,
  type BallotWrittenRecord,
  type BallotTextScreening,
} from '@daisy/protocol';
import { lockRoundBallotScreening } from './round-ballot-screening';
import { ballotScreenings } from './schema/ballot-screenings';
import { jsonObjectSchema } from './schema/columns';
import { sampleRoundExecutionTime } from './round-execution-time';
import type { RoundTimeSource } from './round-execution-time';
import type { JudgingPanelFacts } from '@daisy/protocol';
import { readJudgingPanelFacts } from './judging-panel-read';
import { roundBallotReads } from './round-ballot-reads';
import {
  assertRoundAttendanceSettled,
  type AttendanceSettledRule,
} from './attendance-settlement';
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
import { outcomeJson } from './round-outcome-sql';
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
  requireAgentBallotCapture,
  requireRoundBallot,
  ballotDecisionColumns,
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
  readonly attendanceSettled: AttendanceSettledRule;
  /** Trusted pure domain resource supplied by the human and leased-judge composition. */
  readonly screenWritten: (
    written: BallotWrittenRecord,
    policy: 'hold' | 'off',
  ) => BallotTextScreening;
  /** Pure engine callback. Null means other required judges have not submitted yet. */
  readonly buildProjection: (
    context: LockedRoundBallotContext & {
      readonly ballots: readonly (typeof ballots.$inferSelect)[];
      /** Read with this ballot in place, for the engine's one panel decision. */
      readonly panel: JudgingPanelFacts;
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
  roundTime?: RoundTimeSource,
) {
  const scope = {
    ...input,
    commandId: input.envelope.commandId,
  };
  const fenced = await fenceRoundWrite(tx, scope);
  const screening = await lockRoundBallotScreening(tx, input.roundId);
  const current = await lockedRoundVersion(tx, input.roundId);
  const fresh = await readRoundWriteContext(
    tx,
    scope,
    fenced.accounts,
    'ballot',
    roundTime,
  );
  requireFencedParticipants(fresh.round.participants, fenced.actorIds);
  requireHumanRoundPrincipal(input.principal, fenced.accounts);
  const frozen = requireFrozenRevision(
    await readLockedFrozenRoundTranscript(tx, input.roundId),
    input.envelope.freezeRevision,
  );
  requireAgentBallotCapture(input.principal, frozen);
  const context = { ...fresh, frozen, screening };
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
  roundTime?: RoundTimeSource,
): Promise<RoundBallotReceipt> {
  requireCommandInput(input, roundBallotEnvelopeSchema);
  const { current, context } = await lockedBallotContext(tx, input, roundTime);
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
    // The human window is for humans; an AI seat's budget bounded its generation
    // and a validated ballot may still submit after either (DEC-275).
    ballotDeadlineAt:
      input.principal.kind === 'agent' ? null : (window?.deadline ?? null),
  });
  const stored = await insertFrozenBallot(tx, input, context);
  const ballotId = stored.id;
  const projection = input.buildProjection({
    ...context,
    ballots: [...existing, stored],
    panel: await readJudgingPanelFacts(tx, {
      roundId: input.roundId,
      completeness: context.frozen.completeness,
    }),
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
      attendanceSettled: input.attendanceSettled,
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
      result: { ...receipt, outcome: outcomeJson(receipt.outcome) },
    },
    resultingVersion,
    { before: current.status, projection },
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
  context: LockedRoundBallotContext & {
    readonly screening: Awaited<ReturnType<typeof lockRoundBallotScreening>>;
  },
) {
  const ballotId = input.nextBallotId();
  const body = requireRoundBallot(context.round, input.envelope.ballot);
  const judging = context.round.judging;
  if (!judging) throw createAppError('INVARIANT');
  const source = judging.source;
  const [stored] = await tx
    .insert(ballots)
    .values({
      id: ballotId,
      roundId: input.roundId,
      judgeParticipantId: input.envelope.judgeParticipantId,
      freezeRevision: context.frozen.revision,
      rubricVersion: body.rubricVersion,
      ballotDefinitionId: source.kind === 'stored' ? source.id : null,
      ballotDefinitionVersion: source.kind === 'stored' ? source.version : null,
      speakerRanks: body.speakerRanks ?? null,
      ...ballotDecisionColumns(body),
      scores: body.scores ?? null,
      reason: body.reason ?? null,
      feedback: body.feedback ?? null,
      citations: body.citations ?? null,
      submittedAt: new Date(context.now),
    })
    .returning();
  if (!stored) throw createAppError('INVARIANT');
  const result = ballotTextScreeningSchema.parse(
    input.screenWritten(
      {
        ...(stored.reason === null ? {} : { reason: stored.reason }),
        ...(stored.feedback === null ? {} : { feedback: stored.feedback }),
      },
      context.screening.policy,
    ),
  );
  const screenedAt = new Date(await sampleRoundExecutionTime(tx));
  await tx.insert(ballotScreenings).values({
    ballotId: stored.id,
    lobbyId: context.screening.lobbyId,
    ruleSetVersion: result.ruleSetVersion,
    status: result.status,
    releasedText:
      result.releasedText === null
        ? null
        : jsonObjectSchema.parse(result.releasedText),
    screenedAt,
    createdAt: screenedAt,
    updatedAt: screenedAt,
  });
  return stored;
}
export const roundBallotOperations = ({
  database,
  eventSink,
  roundTime,
}: {
  readonly database: BunSQLDatabase;
  readonly roundTime?: RoundTimeSource | undefined;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  ...roundBallotReads({ database }),
  executeRoundBallot: (input: LockedRoundBallotInput) =>
    instrumented(eventSink, 'executeRoundBallot', () =>
      database.transaction((tx) =>
        executeLockedRoundBallot(tx, input, roundTime),
      ),
    ),
});
