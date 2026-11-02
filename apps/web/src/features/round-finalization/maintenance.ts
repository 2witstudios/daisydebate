import type { IdGenerator } from '@daisy/clock';
import type {
  AttendanceHold,
  AttendanceResolution,
} from '@daisy/db/attendance';
import type { Database } from '@daisy/db';
import {
  createRoundRuntime,
  decidePanelCompletion,
  freezeJudgingPlan,
  participatingRulings,
} from '@daisy/debate-engine';
import { createAppError, isAppError } from '@daisy/errors';
import { createRatingSweep } from '../ratings/sweep';
import { AI_JUDGING_BUDGET_MS } from '../round-judging/budget';
import { roundTickProjection } from './operations';

/** Human judges may rule for 30 minutes after the immutable freeze (DEC-201). */
export const DEFAULT_BALLOT_DEADLINE_MS = 30 * 60_000;
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
      aiJudgingBudgetMs: AI_JUDGING_BUDGET_MS,
    });
type CompletionBuilder = Parameters<
  Database['completePanelRound']
>[0]['buildCompletion'];
/** The engine decides; a judged Round before its persisted ballot deadline is not yet eligible. */
export const panelCompletion =
  (nextId: () => string): CompletionBuilder =>
  ({
    round,
    now,
    ballots,
    ballotDeadlineAt,
    completeness,
    humanJudgeSeatIds,
    runningAiSeatIds,
    failedAiSeatIds,
  }) => {
    const decision = decidePanelCompletion({
      completeness,
      humanJudgeSeatIds,
      runningAiSeatIds,
      failedAiSeatIds,
      judgeSeatIds: round.participants
        .filter((seat) => seat.role === 'judge')
        .map((seat) => seat.id),
      ballots,
      ballotDeadlineAtMs:
        ballotDeadlineAt === null ? Number.NaN : Date.parse(ballotDeadlineAt),
      nowMs: Date.parse(now),
    });
    if (decision.kind === 'pending')
      throw createAppError('CONFLICT', 'panel-ineligible');
    return {
      ruling: decision.ruling,
      noRuling: decision.noRuling,
      ballotIds: participatingRulings(
        round.participants.filter((p) => p.role === 'judge').map((p) => p.id),
        ballots,
      ).map((b) => b.id),
      projection: createRoundRuntime({
        ...round,
        round,
        nextSegmentId: nextId,
      }).completePanel({
        now,
        ballots,
        ballotDeadlineAt,
        completeness,
        humanJudgeSeatIds,
        runningAiSeatIds,
        failedAiSeatIds,
      }),
    };
  };
/** Bound internal ports; the startup owner supplies the existing availability instance. */
export function createRoundMaintenanceOperations(input: {
  readonly store: Pick<
    Database,
    | 'readRoundMaintenanceCandidates'
    | 'tickDueRound'
    | 'finalizeDueRoundTranscript'
    | 'readUnratedRatingRounds'
    | 'rateRound'
    | 'completePanelRound'
  >;
  readonly instanceId: string;
  readonly ratingFailed: (roundId: string, error: unknown) => void;
  /** An AI judge's job ended at completion, with no worker there to report it. */
  readonly judgingEnded?: (reason: string) => void;
  readonly ids: IdGenerator;
  readonly evaluate: (
    roundId: string,
  ) => Promise<AttendanceResolution | AttendanceHold | null>;
  /** Injected policy: how long after the freeze judges may rule (DEC-201). */
  readonly ballotDeadlineMs?: number;
  /**
   * The public check-in probe's Round (ATTENDANCE_PUBLIC_PROBE), or null. It
   * is synthetic and must stay active for its receipt to stay valid, so
   * maintenance never freezes, judges or completes it (ISSUE-530, DEC-231).
   */
  readonly probeRoundId: string | null;
}) {
  const planJudging = judgingPlan(
    input.ballotDeadlineMs ?? DEFAULT_BALLOT_DEADLINE_MS,
  );
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
      });
      if (result.status !== 'frozen') return result;
      try {
        await input.store.completePanelRound({
          instanceId: input.instanceId,
          roundId,
          commandId: input.ids.next(),
          freezeRevision: result.freeze.revision,
          buildProjection,
          buildCompletion: panelCompletion(() => input.ids.next()),
          ...(input.judgingEnded ? { judgingEnded: input.judgingEnded } : {}),
        });
      } catch (error) {
        if (
          !isAppError(error) ||
          error.code !== 'CONFLICT' ||
          ![
            'panel-ineligible',
            'attendance-unsettled',
            'attendance-terminal',
          ].includes(error.message)
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
