import type { IdGenerator } from '@daisy/clock';
import type { AttendanceEvaluation } from '@daisy/db/attendance';
import type { Database } from '@daisy/db';
import {
  attendanceSettled,
  botGrantUnused,
  captureRule,
  createRoundRuntime,
  decidePanelCompletion,
  judgingEndIsReported,
  judgingJobEndReason,
  judgingPanelOf,
  freezeJudgingPlan,
  participatingRulings,
} from '@daisy/debate-engine';
import { createAppError, isAppError, createRefusal } from '@daisy/errors';
import { judgingPolicy, type JudgingTerminalReason } from '@daisy/protocol';
import { createRatingSweep } from '../ratings/sweep';
import { roundTickProjection } from './operations';

type JudgingPlanner = Parameters<
  Database['finalizeDueRoundTranscript']
>[0]['planJudging'];
/** The freeze applies the engine's DEC-208 gate under the injected ballot deadline. */
export const judgingPlan =
  (ballotDeadlineMs: number): JudgingPlanner =>
  (facts) =>
    freezeJudgingPlan({
      ...facts,
      ballotDeadlineMs,
      aiJudgingBudgetMs: judgingPolicy.aiBudgetMs,
    });
type CompletionBuilder = Parameters<
  Database['completePanelRound']
>[0]['buildCompletion'];
/** The engine decides; a judged Round before its persisted ballot deadline is not yet eligible. */
export const panelCompletion =
  (nextId: () => string): CompletionBuilder =>
  ({ round, now, panel: facts, ballotIds }) => {
    const nowMs = Date.parse(now);
    const panel = judgingPanelOf(facts, nowMs);
    if (panel === null) throw createRefusal('CONFLICT', 'panel-ineligible');
    const { completeness, ballots } = facts;
    const decision = decidePanelCompletion({
      completeness,
      panel,
      ballots,
      nowMs,
    });
    if (decision.kind === 'pending')
      throw createRefusal('CONFLICT', 'panel-ineligible');
    return {
      ruling: decision.ruling,
      noRuling: decision.noRuling,
      ballotIds: participatingRulings(
        round.participants.filter((p) => p.role === 'judge').map((p) => p.id),
        ballotIds,
      ).map((b) => b.id),
      projection: createRoundRuntime({
        ...round,
        round,
        nextSegmentId: nextId,
      }).completePanel({ now, ballots, completeness, panel }),
    };
  };
/** Bound internal ports; the startup owner supplies the existing availability instance. */
export function createRoundMaintenanceOperations(input: {
  readonly store: Pick<
    Database,
    | 'readRoundMaintenanceCandidates'
    | 'tickDueRound'
    | 'finalizeDueRoundTranscript'
    | 'readRatingCandidates'
    | 'rateRound'
    | 'completePanelRound'
  >;
  readonly instanceId: string;
  readonly ratingFailed: (roundId: string, error: unknown) => void;
  /** An AI judge's job ended at completion, with no worker there to report it. */
  readonly judgingEnded?: (reason: JudgingTerminalReason) => void;
  /** A freeze ended this Round as a platform incident; called once, for the operator. */
  readonly platformEnded?: (roundId: string) => void;
  readonly ids: IdGenerator;
  readonly evaluate: (roundId: string) => Promise<AttendanceEvaluation>;
  /**
   * The public check-in probe's Round (ATTENDANCE_PUBLIC_PROBE), or null. It
   * is synthetic and must stay active for its receipt to stay valid, so
   * maintenance never freezes, judges or completes it (ISSUE-530, DEC-231).
   */
  readonly probeRoundId: string | null;
}) {
  const planJudging = judgingPlan(judgingPolicy.humanBallotWindowMs);
  const buildProjection = roundTickProjection(() => input.ids.next());
  const ratings = createRatingSweep({
    database: input.store,
    ids: input.ids,
    onFailure: input.ratingFailed,
  });
  let ratingAfterId: string | undefined;
  let discoveryAfterId: string | undefined;
  return {
    /** One bounded page per pulse; the cursor carries a long list across pulses. */
    async discover() {
      const page = await input.store.readRoundMaintenanceCandidates({
        instanceId: input.instanceId,
        limit: 64,
        ...(discoveryAfterId ? { afterId: discoveryAfterId } : {}),
      });
      if (
        !page.exhausted &&
        (!page.afterId || page.afterId === discoveryAfterId)
      )
        throw createAppError(
          'INVARIANT',
          'Maintenance discovery did not advance',
        );
      discoveryAfterId = page.exhausted
        ? undefined
        : (page.afterId ?? undefined);
      return {
        roundIds: page.roundIds.filter((id) => id !== input.probeRoundId),
        openingIds: page.openingIds,
        cycleComplete: page.exhausted,
      };
    },
    tick: (roundId: string) =>
      input.store.tickDueRound({
        instanceId: input.instanceId,
        roundId,
        runsOpening: true,
        buildProjection,
      }),
    evaluate: input.evaluate,
    async finalize(roundId: string) {
      const result = await input.store.finalizeDueRoundTranscript({
        instanceId: input.instanceId,
        roundId,
        buildProjection,
        planJudging,
        botGrantUnused,
        captureRule,
      });
      if (result.status !== 'frozen') return result;
      if (result.platformEnded) input.platformEnded?.(roundId);
      try {
        await input.store.completePanelRound({
          instanceId: input.instanceId,
          roundId,
          commandId: input.ids.next(),
          freezeRevision: result.freeze.revision,
          buildProjection,
          buildCompletion: panelCompletion(() => input.ids.next()),
          judgingEndReason: judgingJobEndReason,
          attendanceSettled,
          judgingEnded: (reason) => {
            if (judgingEndIsReported(reason)) input.judgingEnded?.(reason);
          },
        });
      } catch (error) {
        if (
          !isAppError(error) ||
          (error.reason !== 'panel-ineligible' &&
            error.reason !== 'attendance-unsettled' &&
            error.reason !== 'attendance-terminal')
        )
          throw error;
      }
      return result;
    },
    async rateUnrated() {
      const page = await ratings({
        limit: 64,
        ...(ratingAfterId ? { afterId: ratingAfterId } : {}),
      });
      ratingAfterId = page.exhausted ? undefined : page.afterId;
    },
  };
}
