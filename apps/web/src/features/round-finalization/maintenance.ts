import type { IdGenerator } from '@daisy/clock';
import type { AttendanceResolution, Database } from '@daisy/db';
import { createAppError } from '@daisy/errors';
import { createAttendanceRatingSweep } from '../attendance/rating';
import { roundTickProjection } from './operations';

/** Bound internal ports; the startup owner supplies the existing availability instance. */
export function createRoundMaintenanceOperations(input: {
  readonly store: Pick<
    Database,
    | 'readRoundMaintenanceCandidates'
    | 'tickDueRound'
    | 'finalizeDueRoundTranscript'
    | 'readUnratedAttendanceForfeits'
    | 'rateRound'
  >;
  readonly instanceId: string;
  readonly ids: IdGenerator;
  readonly evaluate: (roundId: string) => Promise<AttendanceResolution | null>;
}) {
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
    finalize: (roundId: string) =>
      input.store.finalizeDueRoundTranscript({
        instanceId: input.instanceId,
        roundId,
        buildProjection,
      }),
    async rateUnrated() {
      const page = await ratings({
        limit: 64,
        ...(ratingAfterId ? { afterId: ratingAfterId } : {}),
      });
      ratingAfterId = page.exhausted ? undefined : page.afterId;
    },
  };
}
