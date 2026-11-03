import type { Database } from '@daisy/db';
import { createRefusal } from '@daisy/errors';
import { debaterFollowUpdateSchema } from '@daisy/protocol';
import {
  audienceRoute,
  type AccountRouteDeps,
} from '../../server/account-route';
import { parseValidated } from '../../server/http';

const FOLLOW_LIMIT = { max: 120, windowSeconds: 3600 };

/**
 * POST /api/debater-follows: an account follows or stops following a debater.
 * Following grants nothing, and one refusal covers yourself, a stranger and a block.
 */
export const createDebaterFollowRoute = (
  deps: AccountRouteDeps & {
    readonly store: Pick<Database, 'setDebaterFollow'>;
  },
) =>
  audienceRoute(
    deps,
    {
      operation: 'following.update',
      limit: FOLLOW_LIMIT,
      maxBodyBytes: 512,
      refusals: ['follow-unavailable'],
    },
    async ({ identity, body }) => {
      const update = parseValidated(debaterFollowUpdateSchema, body);
      const outcome = await deps.store.setDebaterFollow({
        followerUserId: identity.principal.userId,
        username: update.username,
        state: update.state,
      });
      if (outcome === 'unavailable')
        throw createRefusal('CONFLICT', 'follow-unavailable');
      return Response.json({ state: outcome });
    },
  );
