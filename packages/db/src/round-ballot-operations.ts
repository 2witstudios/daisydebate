import { roundBallotReads } from './round-ballot-reads';
import { createAppError } from '@daisy/errors';
import {
  idSchema,
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
import { roundCommands } from './schema/round-commands';

export type RoundBallotLeaseContext = {
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
  const principal = roundPrincipalColumns(input.principal);
  if (
    previous.roundId !== input.roundId ||
    previous.actorId !== principal.actorId ||
    previous.serviceId !== principal.serviceId ||
    previous.payloadDigest !== input.payloadDigest ||
    previous.type !== 'submit_ballot'
  )
    throw createAppError('CONFLICT', 'command-conflict');
  return roundBallotReceiptSchema.parse(previous.result);
}
function requireJudgingRun(
  input: LockedRoundBallotInput,
  context: Awaited<ReturnType<typeof readRoundWriteContext>>,
) {
  if (input.principal.kind !== 'agent') return;
  const config = context.runConfiguration;
  if (
    !input.assertLease ||
    context.runKind !== 'judging' ||
    config?.roundId !== input.roundId ||
    config.judgeParticipantId !== input.envelope.judgeParticipantId ||
    config.freezeRevision !== input.envelope.freezeRevision ||
    !Number.isSafeInteger(config.jobEpoch) ||
    Number(config.jobEpoch) <= 0
  )
    throw createAppError('AUTHORIZATION');
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
  if (
    fresh.round.participants.some((p) => !fenced.actorIds.includes(p.actorId))
  )
    throw createAppError('CONFLICT');
  requireHumanRoundPrincipal(input.principal, fenced.accounts);
  const frozen = await readLockedFrozenRoundTranscript(tx, input.roundId);
  if (!frozen || frozen.revision !== input.envelope.freezeRevision)
    throw createAppError('CONFLICT', 'freeze-not-ready');
  const context = { ...fresh, frozen };
  input.authorize(context);
  requireJudgingRun(input, fresh);
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
  validateBallotInput(input);
  const { current, context } = await lockedBallotContext(tx, input);
  const fresh = context;
  const replay = await replayBallot(tx, input);
  if (replay) return replay;
  if (current.version !== input.envelope.expectedVersion)
    throw createAppError('CONFLICT', 'stale-version');
  if (fresh.round.status !== 'active' || fresh.round.outcome !== null)
    throw createAppError('CONFLICT', 'round-decided');
  const existing = await tx
    .select()
    .from(ballots)
    .where(eq(ballots.roundId, input.roundId));
  if (
    existing.some(
      (b) => b.judgeParticipantId === input.envelope.judgeParticipantId,
    )
  )
    throw createAppError('CONFLICT', 'ballot-already-submitted');
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
  const changed = projection
    ? await writeProjectionWithPhaseSignal(
        tx,
        input.roundId,
        current,
        projection,
        context.now,
      )
    : false;
  const resultingVersion = current.version + (changed ? 1 : 0);
  const receipt: RoundBallotReceipt = {
    commandId: input.envelope.commandId,
    roundId: input.roundId,
    ballotId,
    judgeParticipantId: input.envelope.judgeParticipantId,
    freezeRevision: context.frozen.revision,
    resultingVersion,
    outcome: projection?.round?.outcome ?? null,
  };
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

function validateBallotInput(input: LockedRoundBallotInput) {
  if (
    !idSchema.safeParse(input.roundId).success ||
    !roundBallotEnvelopeSchema.safeParse(input.envelope).success ||
    !/^[0-9a-f]{64}$/.test(input.payloadDigest)
  )
    throw createAppError('VALIDATION');
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
