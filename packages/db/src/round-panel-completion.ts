import { createAppError, isAppError } from '@daisy/errors';
import type { RoundPanelReceipt } from '@daisy/protocol';
import { and, eq, sql } from 'drizzle-orm';
import type { BoundedTransaction } from './bounded-transaction';
import type { BoundedTransactionContext } from './transaction-context';
import { fenceAttendance } from './attendance-facts';
import {
  assertRoundAttendanceSettled,
  type AttendanceSettledRule,
} from './attendance-settlement';
import {
  executeLockedRoundTick,
  type LockedRoundTickInput,
} from './round-clock-transaction';
import { hydrateRoundRows } from './round-hydration';
import type { JudgingPanelFacts, JudgingTerminalReason } from '@daisy/protocol';
import { readJudgingPanelFacts } from './judging-panel-read';
import { endOpenJudgingJobs, type JudgingEndRule } from './round-judging-end';
import { requireCurrentWeb } from './round-service-authority';
import { readTranscriptFreeze } from './frozen-transcript';
import { sampleRoundExecutionTime } from './round-execution-time';
import {
  insertCommandRow,
  lockedRoundVersion,
  writeProjectionWithPhaseSignal,
} from './round-projection-writer';
import { writeSpeakingProjection } from './round-speaking-writer';
import { ballots } from './schema/ballots';
import { roundCommands } from './schema/round-commands';
import {
  requireCompletionProjection,
  requirePanelFacts,
  requirePanelRequest,
  requirePanelRound,
  requirePanelTerminal,
  panelDigest,
  panelReceipt,
  validatePanelReceipt,
  type PanelDurableFacts,
} from './round-panel-decisions';

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
  readonly instanceId: string;
  readonly commandId: string;
  readonly freezeRevision: number;
  /** Once per AI job this completion ended without a ballot. */
  readonly judgingEnded?: (reason: JudgingTerminalReason) => void;
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
  const receipt = validatePanelReceipt(row, input, digest);
  requirePanelTerminal(
    await lockedRoundVersion(tx, input.roundId),
    receipt.outcome,
  );
  await requireCurrentWeb(tx, input.instanceId);
  return { ...receipt, replayed: true };
}

async function readCompletionFacts(
  tx: BoundedTransactionContext,
  input: Request,
) {
  await requireCurrentWeb(tx, input.instanceId, true);
  await executeLockedRoundTick(tx, input);
  const round = await hydrateRoundRows(tx, input.roundId);
  const freeze = await readTranscriptFreeze(tx, input.roundId);
  const [durable] =
    await tx.execute(sql`select final_segment_ended_at,transcript_admission_cutoff,ballot_deadline_at,
    exists(select 1 from rating_changes where round_id=${input.roundId}) as ratings
    from rounds where id=${input.roundId}`);
  const now = await sampleRoundExecutionTime(tx);
  requirePanelRound(round);
  const { freeze: frozen } = requirePanelFacts({
    freezeRevision: input.freezeRevision,
    freeze,
    durable: durable as PanelDurableFacts | undefined,
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

async function complete(tx: BoundedTransactionContext, input: Request) {
  await requireCurrentWeb(tx, input.instanceId);
  const digest = panelDigest(input);
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${input.commandId},59002))`,
  );
  const prior = await replay(tx, input, digest, true);
  if (prior) return { receipt: prior, ended: [] };
  try {
    await fenceAttendance(tx, input.roundId, input.commandId, null);
  } catch (error) {
    if (
      isAppError(error) &&
      error.code === 'CONFLICT' &&
      error.message === 'attendance-terminal'
    ) {
      const terminal = await replay(tx, input, digest, false);
      if (terminal) return { receipt: terminal, ended: [] };
    }
    throw error;
  }
  const { round, freeze, now, panel, ballotIds } = await readCompletionFacts(
    tx,
    input,
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
  );
  if (!changed) throw createAppError('CONFLICT', 'panel-projection');
  const receipt = panelReceipt({
    commandId: input.commandId,
    roundId: input.roundId,
    freezeRevision: freeze.revision,
    resultingVersion: current.version + 1,
    ruling: completion.ruling,
    outcome: projection.round!.outcome,
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
      result: { ...receipt, noRuling: [...receipt.noRuling] },
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
  return { receipt, ended };
}

export function roundPanelCompletionOperations(run: BoundedTransaction) {
  return {
    async completePanelRound(input: Request): Promise<RoundPanelReceipt> {
      requirePanelRequest(input);
      const { receipt, ended } = await run((tx) => complete(tx, input));
      // After commit, and even with no judging worker running. A job still open
      // here could not rule: out of budget, or a held ballot that never submitted.
      for (const reason of ended) input.judgingEnded?.(reason);
      return receipt;
    },
  };
}
