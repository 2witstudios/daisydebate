import { requireAuthorization } from '@daisy/auth/request-authorization';
import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import type { OwnCollectionFence } from '@daisy/db/authorization';
import { ratingVisibilitySchema } from '@daisy/protocol';
import { requireMemberActor } from '../access/actor';
import type { App } from '../../server/app';
import { parseValidated, readJson } from '../../server/http';
import {
  memberHttpBoundary,
  runMemberHandler,
} from '../../server/member-handler';
import { consumeOrThrow } from '../../server/rate-limit';

const RULE = { windowSeconds: 60, max: 30 } as const;

const own =
  (
    principal: AuthorizationPrincipal,
    capability:
      'social.rating_visibility.read' | 'social.rating_visibility.update',
  ): OwnCollectionFence<{ readonly actorId: string }> =>
  async ({ scope, account }) =>
    requireAuthorization({
      principal,
      capability,
      resource: { kind: 'friend_collection', actorId: scope.actorId },
      context: { account },
    });

/** Which ratings the member's card shows besides Freestyle (ADR 0097). */
export function composeRatingVisibilityRoutes(app: App) {
  const boundary = memberHttpBoundary(app);
  return {
    read: (request: Request) =>
      runMemberHandler(boundary, request, {
        name: 'ratings.visibility.read',
        readOnly: true,
        readInput: async () => null,
        operation: async (_input, principal) => {
          const { actorId, userId } = requireMemberActor(principal);
          return ratingVisibilitySchema.parse({
            version: 1,
            ...(await app.database.readRatingVisibility(
              { userId, actorId },
              own(principal, 'social.rating_visibility.read'),
            )),
          });
        },
        headers: { 'cache-control': 'no-store' },
      }),
    write: (request: Request) =>
      runMemberHandler(boundary, request, {
        name: 'ratings.visibility.write',
        readOnly: false,
        readInput: () => readJson(request, 256),
        operation: async (input, principal) => {
          const { actorId, userId } = requireMemberActor(principal);
          await consumeOrThrow(
            app.limiter,
            `rating-visibility:${actorId}`,
            RULE,
          );
          const { showPolicy, showValue } = parseValidated(
            ratingVisibilitySchema,
            input,
          );
          return ratingVisibilitySchema.parse({
            version: 1,
            ...(await app.database.writeRatingVisibility(
              { userId, actorId },
              { showPolicy, showValue, now: app.clock.now() },
              own(principal, 'social.rating_visibility.update'),
            )),
          });
        },
      }),
  };
}
