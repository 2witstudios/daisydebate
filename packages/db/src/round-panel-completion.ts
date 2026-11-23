import type { DecisionReleasePolicy } from '@daisy/protocol/round-decision-release';
import { isAppError, createAppError, createRefusal } from '@daisy/errors';
import {
  frozenCaptureOf,
  platformLostTooMuch,
} from '@daisy/protocol/capture-judging-limit';
import {
  type RoundPanelReceipt,
  roundPanelReceiptSchema,
} from '@daisy/protocol/round-panel-completion';
import { and, eq, sql } from 'drizzle-orm';
import type { BoundedTransaction } from './bounded-transaction';
import {
  lockAttendanceAuthority,
  readAttendanceSeats,
} from './attendance-facts';
import { rounds } from './schema/rounds';
import { refundPlatformEndedLocked } from './round-bot-admission';
import {
  assertRoundAttendanceSettled,
  type AttendanceSettledRule,
} from './attendance-settlement';
import {
  executeLockedRoundTick,
  type LockedRoundTickInput,
} from './round-clock-transaction';
import { hydrateRoundRows, type RoundHydration } from './round-hydration';
import type { JudgingPanelFacts } from '@daisy/protocol/round-panel-completion';
import type { JudgingTerminalReason } from '@daisy/protocol/round-judging-attempt';
import { readJudgingPanelFacts } from './judging-panel-read';
import { endOpenJudgingJobs, type JudgingEndRule } from './round-judging-end';
import { requireCurrentWeb } from './web-service-authority';
import { readTranscriptFreeze } from './frozen-transcript';
import {
  sampleRoundExecutionTime,
  type RoundTimeSource,
} from './round-execution-time';
import {
  insertCommandRow,
  lockedRoundVersion,
  writeProjectionWithPhaseSignal,
} from './round-projection-writer';
import { writeSpeakingProjection } from './round-speaking-writer';
import { ballots } from './schema/ballots';
import { outcomeJson } from './round-outcome-sql';
import { roundCommands } from './schema/round-commands';
import type { Tx } from './tx';
import { takeLock, transactionLocks } from './locks';
import { query } from './raw-rows';
import { z } from 'zod';
import { commandDigest } from '@daisy/digest';
import { idSchema } from '@daisy/protocol/primitives';
import { type RoundOutcome } from '@daisy/protocol/round-outcome';
import { type RoundProjection } from '@daisy/protocol/runtime';

type CompletionFacts = Parameters<
  LockedRoundTickInput['buildProjection']
>[0] & {
  /** Read under the Round lock, for the engine's one panel decision. */
  readonly panel: JudgingPanelFacts;
  /** Stored ballot ids, for the finalization record. */
  readonly ballotIds: readonly {
    readonly id: string;
    readonly judgeParticipantId: string;
  }[];
};
type Request = LockedRoundTickInput & {
  readonly requireActiveRound: (round: RoundHydration) => void;
  readonly requirePlayedRound: (
    round: RoundHydration | null,
  ) => asserts round is RoundHydration;
  readonly instanceId: string;
  readonly commandId: string;
  readonly freezeRevision: number;
  /** Once per AI job this completion ended without a ballot. */
  readonly judgingEnded?: (reason: JudgingTerminalReason) => void;
  /** The platform lost more than can be judged and ended this Round; once, for the operator. */
  readonly platformEnded?: () => void;
  readonly judgingEndReason: JudgingEndRule;
  readonly attendanceSettled: AttendanceSettledRule;
  /** The engine decides; the caller supplies the ruling it decided with the projection. */
  readonly buildCompletion: (facts: CompletionFacts) => {
    readonly projection: ReturnType<LockedRoundTickInput['buildProjection']>;
    readonly ruling: RoundPanelReceipt['ruling'];
    readonly noRuling: readonly string[];
    readonly ballotIds: readonly string[];
  };
};
async function replay(
  tx: Tx,
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
  const receipt = validatePanelReceipt(row, input, digest);
  requirePanelTerminal(
    await lockedRoundVersion(tx, input.roundId),
    receipt.outcome,
  );
  await requireCurrentWeb(tx, input.instanceId);
  return { ...receipt, replayed: true };
}

async function readCompletionFacts(
  tx: Tx,
  input: Request,
  roundTime?: RoundTimeSource,
) {
  await requireCurrentWeb(tx, input.instanceId, true);
  await executeLockedRoundTick(tx, input, roundTime);
  const round = await hydrateRoundRows(tx, input.roundId);
  const freeze = await readTranscriptFreeze(tx, input.roundId);
  const [durable] = await query(
    tx,
    z.object({
      final_segment_ended_at: z.date().nullable(),
      transcript_admission_cutoff: z.date().nullable(),
      ballot_deadline_at: z.date().nullable(),
      ratings: z.boolean(),
    }),
    sql`select final_segment_ended_at,transcript_admission_cutoff,ballot_deadline_at,
    public.daisy_round_rating_posted(id) as ratings
    from rounds where id=${input.roundId}`,
  );
  const now = await sampleRoundExecutionTime(tx, roundTime);
  input.requirePlayedRound(round);
  const { freeze: frozen } = requirePanelFacts({
    freezeRevision: input.freezeRevision,
    freeze,
    durable,
  });
  await assertRoundAttendanceSettled(tx, {
    roundId: input.roundId,
    now,
    attendanceSettled: input.attendanceSettled,
  });
  const stored = await tx
    .select({
      id: ballots.id,
      judgeParticipantId: ballots.judgeParticipantId,
    })
    .from(ballots)
    .where(eq(ballots.roundId, input.roundId));
  return {
    round,
    freeze: frozen,
    now,
    ballotIds: stored as CompletionFacts['ballotIds'],
    panel: await readJudgingPanelFacts(tx, {
      roundId: input.roundId,
      completeness: frozen.completeness,
    }),
  };
}

async function complete(tx: Tx, input: Request, roundTime?: RoundTimeSource) {
  await requireCurrentWeb(tx, input.instanceId);
  const digest = panelDigest(input);
  await takeLock(tx, transactionLocks.roundCommand(input.commandId));
  const prior = await replay(tx, input, digest, true);
  if (prior) return { receipt: prior, ended: [] };
  try {
    const locked = await lockAttendanceAuthority(
      tx,
      input.roundId,
      input.commandId,
      null,
    );
    input.requireActiveRound(locked.round);
    await readAttendanceSeats(tx, locked);
  } catch (error) {
    if (isAppError(error) && error.reason === 'attendance-terminal') {
      const terminal = await replay(tx, input, digest, false);
      if (terminal) return { receipt: terminal, ended: [] };
    }
    throw error;
  }
  const { round, freeze, now, panel, ballotIds } = await readCompletionFacts(
    tx,
    input,
    roundTime,
  );
  const completion = input.buildCompletion({ round, now, panel, ballotIds });
  requireCompletionProjection(completion);
  const { projection } = completion;
  const current = await lockedRoundVersion(tx, input.roundId);
  await requireCurrentWeb(tx, input.instanceId);
  const changed = await writeProjectionWithPhaseSignal(
    tx,
    input.roundId,
    current,
    projection,
    now,
    input.decisionRelease,
  );
  if (!changed)
    throw createAppError('CONFLICT', 'Panel projection did not apply');
  // The Round ends here, attendance settled, so this is when it can be said the platform
  // ended it: a freeze cannot know that attendance will not end it another way.
  const platformEnded =
    completion.ruling === 'transcript-incomplete' &&
    platformLostTooMuch(frozenCaptureOf(freeze));
  if (platformEnded) {
    await tx
      .update(rounds)
      .set({ platformEnding: 'capture_shortfall' })
      .where(eq(rounds.id, input.roundId));
    await refundPlatformEndedLocked(tx, input.roundId, {
      kind: 'capture_shortfall',
      commandId: input.commandId,
      freezeRevision: freeze.revision,
    });
  }
  const receipt = panelReceipt({
    commandId: input.commandId,
    roundId: input.roundId,
    freezeRevision: freeze.revision,
    resultingVersion: current.version + 1,
    ruling: completion.ruling,
    outcome: projection.round.outcome,
    noRuling: completion.noRuling,
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
      result: {
        ...receipt,
        outcome: outcomeJson(receipt.outcome),
        noRuling: [...receipt.noRuling],
      },
    },
    receipt.resultingVersion,
    {
      before: current.status,
      projection: {
        ...projection,
        finalization: {
          freezeRevision: freeze.revision,
          ballotIds: completion.ballotIds,
        },
      },
    },
  );
  await writeSpeakingProjection(tx, {
    roundId: input.roundId,
    projection,
    resultingVersion: receipt.resultingVersion,
    commandId: input.commandId,
  });
  const ended = await endOpenJudgingJobs(tx, {
    roundId: input.roundId,
    ending: 'panel_closed',
    now,
    judgingEndReason: input.judgingEndReason,
  });
  await requireCurrentWeb(tx, input.instanceId);
  return { receipt, ended, platformEnded };
}

export function roundPanelCompletionOperations(
  run: BoundedTransaction,
  roundTime?: RoundTimeSource,
  decisionRelease?: DecisionReleasePolicy,
) {
  return {
    async completePanelRound(input: Request): Promise<RoundPanelReceipt> {
      requirePanelRequest(input);
      const { receipt, ended, platformEnded } = await run((tx) =>
        complete(tx, { ...input, decisionRelease }, roundTime),
      );
      if (platformEnded) input.platformEnded?.();
      // After commit, and even with no judging worker running. A job still open
      // here could not rule: out of budget, or a held ballot that never submitted.
      for (const reason of ended) input.judgingEnded?.(reason);
      return receipt;
    },
  };
}

/** The identity of one internal panel completion request. */
export type PanelRequest = {
  readonly instanceId: string;
  readonly commandId: string;
  readonly roundId: string;
  readonly freezeRevision: number;
};
type CommandRow = typeof roundCommands.$inferSelect;
/** Durable Round facts read under the Round lock. */
export type PanelDurableFacts = {
  readonly final_segment_ended_at: unknown;
  readonly transcript_admission_cutoff: unknown;
  readonly ballot_deadline_at: unknown;
  readonly ratings: unknown;
};

const ineligible = () => createRefusal('CONFLICT', 'panel-ineligible');
const receiptConflict = () =>
  createAppError('CONFLICT', 'Panel receipt conflicts with its command');

export function requirePanelRequest(input: PanelRequest): void {
  if (
    ![input.instanceId, input.commandId, input.roundId].every(
      (id) => idSchema.safeParse(id).success,
    ) ||
    !Number.isSafeInteger(input.freezeRevision) ||
    input.freezeRevision < 1
  )
    throw createAppError('VALIDATION');
}

/** Binds a command row to this Round and frozen revision, never to the caller. */
export const panelDigest = (input: PanelRequest) =>
  commandDigest({
    purpose: 'complete-panel',
    roundId: input.roundId,
    freezeRevision: input.freezeRevision,
  });

function requireReceiptCommand(
  row: CommandRow,
  input: PanelRequest,
  digest: string,
) {
  if (
    row.roundId !== input.roundId ||
    row.type !== 'complete' ||
    row.actorId !== null ||
    !row.serviceId?.startsWith('round-finalization:') ||
    row.payloadDigest !== digest
  )
    throw receiptConflict();
}

/** A stored completion replays only if it is this service's exact panel receipt. */
export function validatePanelReceipt(
  row: CommandRow,
  input: PanelRequest,
  digest: string,
) {
  requireReceiptCommand(row, input, digest);
  const receipt = roundPanelReceiptSchema.parse(row.result);
  if (
    receipt.roundId !== input.roundId ||
    receipt.freezeRevision !== input.freezeRevision ||
    receipt.commandId !== row.commandId ||
    receipt.resultingVersion !== row.resultingVersion
  )
    throw receiptConflict();
  return receipt;
}

/** The ruling of the Round's panel completion receipt among its command rows, or null when it has none. */
export function recordedPanelRuling(
  rows: readonly Pick<
    CommandRow,
    'type' | 'actorId' | 'serviceId' | 'result'
  >[],
): RoundPanelReceipt['ruling'] | null {
  for (const row of rows) {
    if (
      row.type !== 'complete' ||
      row.actorId !== null ||
      !row.serviceId?.startsWith('round-finalization:')
    )
      continue;
    const receipt = roundPanelReceiptSchema.safeParse(row.result);
    if (receipt.success) return receipt.data.ruling;
  }
  return null;
}

/** A replayed receipt stands only while the Round is still completed with its recorded outcome. */
export function requirePanelTerminal(
  round: { readonly status: string; readonly outcome: RoundOutcome | null },
  recorded: RoundOutcome | null,
): void {
  if (round.status !== 'completed' || !sameOutcome(round.outcome, recorded))
    throw receiptConflict();
}

/** Two outcomes say the same: the same winning side, or the same places. */
const sameOutcome = (
  a: RoundOutcome | null,
  b: RoundOutcome | null,
): boolean => {
  if (a === null || b === null) return a === b;
  if (a.kind === 'winner' || b.kind === 'winner')
    return a.kind === 'winner' && b.kind === 'winner' && a.side === b.side;
  return (
    a.of === b.of &&
    a.places.length === b.places.length &&
    a.places.every(
      (place, index) =>
        place.length === b.places[index]?.length &&
        place.every((id, at) => b.places[index]?.[at] === id),
    )
  );
};

/**
 * The requested freeze and no rating fact yet. Nobody's seat can hold a played
 * Round open: a closed account ends in a result like any other, and the deadline
 * records no ruling for a judge who left.
 * Returns the freeze and the ballot deadline persisted at it, as UTC ISO.
 */
export function requirePanelFacts<
  Freeze extends { readonly revision: number },
>(input: {
  readonly freezeRevision: number;
  readonly freeze: Freeze | null | undefined;
  readonly durable: PanelDurableFacts | undefined;
}): { readonly freeze: Freeze; readonly ballotDeadlineAt: string | null } {
  const { freeze, durable } = input;
  if (
    !freeze ||
    freeze.revision !== input.freezeRevision ||
    !durable ||
    !durable.final_segment_ended_at ||
    !durable.transcript_admission_cutoff ||
    durable.ratings
  )
    throw ineligible();
  return {
    freeze,
    ballotDeadlineAt: durable.ballot_deadline_at
      ? new Date(durable.ballot_deadline_at as string).toISOString()
      : null,
  };
}

/**
 * The engine's completion finishes the Round with no segment change, and
 * names a winner exactly when some judges ruled (`partial`).
 */
type CompletionRound = Pick<
  NonNullable<RoundProjection['round']>,
  'status' | 'outcome'
>;

export function requireCompletionProjection(completion: {
  readonly projection: {
    readonly round?: CompletionRound | null | undefined;
    readonly segmentInserts: readonly unknown[];
    readonly segmentCloses: readonly unknown[];
  };
  readonly ruling: RoundPanelReceipt['ruling'];
}): asserts completion is typeof completion & {
  readonly projection: { readonly round: CompletionRound };
} {
  const { projection } = completion;
  if (
    projection.round?.status !== 'completed' ||
    (completion.ruling !== 'partial') !== (projection.round.outcome === null) ||
    projection.segmentInserts.length ||
    projection.segmentCloses.length
  )
    throw createAppError(
      'CONFLICT',
      'Panel projection does not match its completion',
    );
}

export const panelReceipt = (input: {
  readonly commandId: string;
  readonly roundId: string;
  readonly freezeRevision: number;
  readonly resultingVersion: number;
  readonly ruling: RoundPanelReceipt['ruling'];
  readonly outcome: RoundPanelReceipt['outcome'];
  readonly noRuling: readonly string[];
}) =>
  roundPanelReceiptSchema.parse({
    version: 1,
    ...input,
    status: 'completed',
    replayed: false,
  });
