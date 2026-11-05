import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import type { BoundedTransaction } from './bounded-transaction';
import { currentWebTransaction } from './web-service-authority';
import { createUsageRelease } from './usage-release';
import { rounds } from './schema/rounds';
import { actors } from './schema/actors';
import { users } from './schema/users';

type ReleasePolicy = Parameters<typeof createUsageRelease>[0]['releaseBinding'];

/** Durable discovery is only a hint; the existing release fences re-read every fact. */
export function usageRecoveryOperations(run: BoundedTransaction) {
  return {
    readAbandonedUsageCandidates(input: {
      readonly instanceId: string;
      readonly afterId?: string;
      readonly limit: number;
    }) {
      if (
        !Number.isSafeInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > 100 ||
        (input.afterId !== undefined &&
          !idSchema.safeParse(input.afterId).success)
      )
        throw createAppError('VALIDATION');
      return currentWebTransaction(
        run,
        input.instanceId,
      )(async (tx) => {
        const candidates = await tx
          .select({ roundId: rounds.id, actorId: actors.id })
          .from(rounds)
          .innerJoin(actors, eq(actors.id, rounds.createdByActorId))
          .innerJoin(users, eq(users.id, actors.userId))
          .where(
            and(
              eq(rounds.status, 'abandoned'),
              sql`${users.deletedAt} is null`,
              ...(input.afterId === undefined
                ? []
                : [gt(rounds.id, input.afterId)]),
              sql`exists(select 1 from usage_reservations u where u.round_id=${rounds.id}
              and u.actor_id=${actors.id} and u.kind in ('ai_round','casual_ai_judge')
              and (u.state->>'kind'='reserved' or (u.kind='ai_round' and u.binds_free_judge
                and u.binding_released_at is null and u.state->>'kind'='released')))`,
            ),
          )
          .orderBy(asc(rounds.id))
          .limit(input.limit);
        return {
          candidates,
          afterId: candidates.at(-1)?.roundId ?? null,
          exhausted: candidates.length < input.limit,
        };
      });
    },
    releaseAbandonedUsage(
      input: {
        readonly instanceId: string;
        readonly actorId: string;
        readonly roundId: string;
      },
      releaseBinding: ReleasePolicy,
    ) {
      return createUsageRelease({
        run: currentWebTransaction(run, input.instanceId),
        releaseBinding,
      })(input);
    },
  };
}
