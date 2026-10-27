import type { IdGenerator } from '@daisy/clock';
import type { AttendanceResolution } from '@daisy/db/attendance';
import type { Database } from '@daisy/db';
import {
  createRoundRuntime,
  decideUnjudgedCompletion,
  maintainRoom,
  freezeJudgingPlan,
} from '@daisy/debate-engine';
import { createAppError, isAppError } from '@daisy/errors';
import { createAttendanceRatingSweep } from '../attendance/rating';
import { maintenanceTickProjection, roundTickProjection } from './operations';

/** Judges may rule for 30 minutes after the immutable freeze (DEC-201). */
export const DEFAULT_BALLOT_DEADLINE_MS = 30 * 60_000;
/** A Round not started 15 minutes after Launch is abandoned (DEC-214). */
export const ROUND_START_HORIZON_MS = 15 * 60_000;
type JudgingPlanner = Parameters<
  Database['finalizeDueRoundTranscript']
>[0]['planJudging'];
/** The freeze applies the engine's DEC-208 gate under the injected ballot deadline. */
export const judgingPlan =
  (ballotDeadlineMs: number): JudgingPlanner =>
  (facts) =>
    freezeJudgingPlan({ ...facts, ballotDeadlineMs });
type CompletionBuilder = Parameters<
  Database['completeUnjudgedRound']
>[0]['buildCompletion'];
/** The engine decides; a judged Round before its persisted ballot deadline is not yet eligible. */
export const unjudgedCompletion =
  (nextId: () => string): CompletionBuilder =>
  ({
    round,
    now,
    ballots,
    ballotDeadlineAt,
    completeness,
    humanJudgeSeatIds,
  }) => {
    const decision = decideUnjudgedCompletion({
      completeness,
      humanJudgeSeatIds,
      judgeSeatIds: round.participants
        .filter((seat) => seat.role === 'judge')
        .map((seat) => seat.id),
      ballots,
      ballotDeadlineAtMs:
        ballotDeadlineAt === null ? Number.NaN : Date.parse(ballotDeadlineAt),
      nowMs: Date.parse(now),
    });
    if (decision.kind === 'pending')
      throw createAppError('CONFLICT', 'unjudged-ineligible');
    return {
      ruling: decision.ruling,
      noRuling: decision.noRuling,
      projection: createRoundRuntime({
        ...round,
        round,
        nextSegmentId: nextId,
      }).completeUnjudged({
        competitionType: round.competitionType,
        now,
        ballots,
        ballotDeadlineAt,
        completeness,
        humanJudgeSeatIds,
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
    | 'readUnratedAttendanceForfeits'
    | 'rateRound'
    | 'completeUnjudgedRound'
    | 'readMaintenanceCandidates'
    | 'maintainRoom'
  >;
  readonly instanceId: string;
  readonly ids: IdGenerator;
  readonly evaluate: (roundId: string) => Promise<AttendanceResolution | null>;
  /** Injected policy: how long after the freeze judges may rule (DEC-201). */
  readonly ballotDeadlineMs?: number;
  /** Injected policy, never defaulted: how long a launched Round may stay unstarted (DEC-214). */
  readonly startHorizonMs: number;
  /**
   * The public check-in probe's Round (ATTENDANCE_PUBLIC_PROBE), or null. It
   * is synthetic and must stay active for its receipt to stay valid, so
   * maintenance never freezes, judges or completes it (ISSUE-530, DEC-231).
   */
  readonly probeRoundId: string | null;
  /** Injected Room policy, or null to leave idle Room expiry inert (ADR 0070). */
  readonly idleTimeoutMs: number | null;
}) {
  const planJudging = judgingPlan(
    input.ballotDeadlineMs ?? DEFAULT_BALLOT_DEADLINE_MS,
  );
  const buildProjection = roundTickProjection(() => input.ids.next());
  const tickProjection = maintenanceTickProjection(
    () => input.ids.next(),
    input.startHorizonMs,
  );
  const ratings = createAttendanceRatingSweep({
    database: input.store,
    ids: input.ids,
  });
  let ratingAfterId: string | undefined;
  return {
    async discover() {
      const ids: string[] = [];
      let afterId: string | undefined;
      for (;;) {
        const page = await input.store.readRoundMaintenanceCandidates({
          instanceId: input.instanceId,
          limit: 64,
          startHorizonMs: input.startHorizonMs,
          ...(afterId ? { afterId } : {}),
        });
        ids.push(...page.roundIds.filter((id) => id !== input.probeRoundId));
        if (page.exhausted) return ids;
        if (!page.afterId || page.afterId === afterId)
          throw createAppError(
            'INVARIANT',
            'Maintenance discovery did not advance',
          );
        afterId = page.afterId;
      }
    },
    tick: (roundId: string) =>
      input.store.tickDueRound({
        instanceId: input.instanceId,
        roundId,
        buildProjection: tickProjection,
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
        await input.store.completeUnjudgedRound({
          instanceId: input.instanceId,
          roundId,
          commandId: input.ids.next(),
          freezeRevision: result.freeze.revision,
          buildProjection,
          buildCompletion: unjudgedCompletion(() => input.ids.next()),
        });
      } catch (error) {
        if (
          !isAppError(error) ||
          error.code !== 'CONFLICT' ||
          ![
            'unjudged-ineligible',
            'attendance-unsettled',
            'attendance-terminal',
          ].includes(error.message)
        )
          throw error;
      }
      return result;
    },
    /**
     * Settles due draw strikes and closes open Rooms idle past the policy
     * timeout, a page per pulse. Settlement runs even with expiry unset. A
     * Room that fails is reported after the page, so it never holds back
     * the Rooms after it.
     */
    async maintainRooms() {
      const idleTimeoutMs = input.idleTimeoutMs;
      const roomIds = await input.store.readMaintenanceCandidates({
        idleTimeoutMs,
        limit: 64,
      });
      const failures: unknown[] = [];
      for (const roomId of roomIds)
        await input.store
          .maintainRoom({
            roomId,
            maintain: (state, facts) =>
              maintainRoom(state, {
                lastCommandAt: facts.lastCommandAt,
                now: facts.now,
                idleTimeoutMs,
                drawSeed: facts.drawSeed,
              }),
          })
          .catch((error: unknown) => failures.push(error));
      if (failures.length)
        throw new AggregateError(failures, 'Room maintenance failed');
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
