import type { Clock } from '@daisy/clock';
import type { Database } from '@daisy/db';
import { watchHistoryUpdateSchema } from '@daisy/protocol';
import {
  accountRoute,
  type AccountRouteDeps,
} from '../../server/account-route';
import { parseValidated } from '../../server/http';

const HISTORY_LIMIT = { max: 240, windowSeconds: 3600 };

/** POST /api/watch-history: records a visit, forgets one, or clears the lot. */
export const createWatchHistoryRoute = (
  deps: AccountRouteDeps & {
    readonly store: Pick<
      Database,
      'recordWatched' | 'forgetWatched' | 'clearWatchHistory'
    >;
    readonly clock: Pick<Clock, 'now'>;
  },
) =>
  accountRoute(
    deps,
    {
      operation: 'watch-history.update',
      limit: HISTORY_LIMIT,
      maxBodyBytes: 256,
      refusals: [],
    },
    async ({ identity, body }) => {
      const update = parseValidated(watchHistoryUpdateSchema, body);
      const { userId } = identity.principal;
      if (update.kind === 'watched')
        await deps.store.recordWatched({
          userId,
          roundId: update.roundId,
          at: deps.clock.now(),
        });
      else if (update.kind === 'forget')
        await deps.store.forgetWatched({ userId, roundId: update.roundId });
      else await deps.store.clearWatchHistory({ userId });
      return Response.json({ received: true });
    },
  );
