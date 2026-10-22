import type { IdGenerator } from '@daisy/clock';
import type { AttendanceResolution, Database } from '@daisy/db';
import {
  createRoundRuntime,
  decideUnjudgedCompletion,
} from '@daisy/debate-engine';
import { createAppError, isAppError } from '@daisy/errors';
import { createAttendanceRatingSweep } from '../attendance/rating';
import { roundTickProjection } from './operations';

/** Judges may rule for 30 minutes after the immutable freeze (DEC-201). */
export const DEFAULT_BALLOT_DEADLINE_MS = 30 * 60_000;
type CompletionBuilder = Parameters<
  Database['completeUnjudgedRound']
>[0]['buildCompletion'];
/** The engine decides; a judged Round inside its ballot deadline is not yet eligible. */
export const unjudgedCompletion =
  (nextId: () => string, ballotDeadlineMs: number): CompletionBuilder =>
  ({ round, now, ballots, frozenAt }) => {
    const decision = decideUnjudgedCompletion({
      judgeSeatIds: round.participants
        .filter((seat) => seat.role === 'judge')
        .map((seat) => seat.id),
      ballots,
      frozenAtMs: Date.parse(frozenAt),
      ballotDeadlineMs,
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
        frozenAt,
        ballotDeadlineMs,
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
  >;
  readonly instanceId: string;
  readonly ids: IdGenerator;
  readonly evaluate: (roundId: string) => Promise<AttendanceResolution | null>;
  /** Injected policy: how long after the freeze judges may rule (DEC-201). */
  readonly ballotDeadlineMs?: number;
}) {
  const ballotDeadlineMs = input.ballotDeadlineMs ?? DEFAULT_BALLOT_DEADLINE_MS;
  const buildProjection = roundTickProjection(() => input.ids.next());
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
          ...(afterId ? { afterId } : {}),
        });
        ids.push(...page.roundIds);
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
        buildProjection,
      }),
    evaluate: input.evaluate,
    async finalize(roundId: string) {
      const result = await input.store.finalizeDueRoundTranscript({
        instanceId: input.instanceId,
        roundId,
        buildProjection,
      });
      if (result.status !== 'frozen') return result;
      try {
        await input.store.completeUnjudgedRound({
          instanceId: input.instanceId,
          roundId,
          commandId: input.ids.next(),
          freezeRevision: result.freeze.revision,
          buildProjection,
          buildCompletion: unjudgedCompletion(
            () => input.ids.next(),
            ballotDeadlineMs,
          ),
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
    async rateUnrated() {
      const page = await ratings({
        limit: 64,
        ...(ratingAfterId ? { afterId: ratingAfterId } : {}),
      });
      ratingAfterId = page.exhausted ? undefined : page.afterId;
    },
  };
}
