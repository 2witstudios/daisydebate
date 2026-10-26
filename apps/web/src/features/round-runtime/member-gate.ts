import type { Identity } from '@daisy/auth';
import type { Logger } from '@daisy/logger';
import { createAppError } from '@daisy/errors';
import { consumeOrThrow, type AuthRateLimiter } from '../auth/abuse/rate-limit';
import {
  refusalResponse,
  handleOperation,
  requireSameOrigin,
  requireSameOriginRead,
  requireSignedIn,
} from '../../server/http';
export type RoundCaller = { readonly userId: string; readonly actorId: string };
type Rule = { readonly max: number; readonly windowSeconds: number };
export type RoundMemberRouteDependencies = {
  readonly logger: Logger;
  readonly identify: (request: Request) => Promise<Identity>;
  readonly origin: () => string;
  readonly getActorByUserId: (
    id: string,
  ) => Promise<{ readonly id: string } | null>;
  readonly limiter: () => AuthRateLimiter;
  readonly limits: { readonly read: Rule; readonly command: Rule };
  readonly active: () => boolean;
};
/** Origin, session, member, limiter and fresh actor gates for both competitive write contracts. */
export function createRoundMemberGate(d: RoundMemberRouteDependencies) {
  return (
    request: Request,
    operation: 'read' | 'command',
    action: (caller: RoundCaller) => Promise<Response>,
  ) =>
    handleOperation(
      d.logger,
      request,
      `round.${operation}`,
      async (requestId) => {
        if (!d.active()) throw createAppError('NOT_FOUND');
        if (operation === 'command') requireSameOrigin(request, d.origin());
        else requireSameOriginRead(request, d.origin());
        const identity = requireSignedIn(await d.identify(request));
        if (identity.state !== 'member') throw createAppError('AUTHORIZATION');
        await consumeOrThrow(
          d.limiter(),
          `round:${operation}:${identity.principal.userId}`,
          d.limits[operation],
        );
        const actor = await d.getActorByUserId(identity.principal.userId);
        if (!actor || actor.id !== identity.principal.actorId)
          throw createAppError('INFRASTRUCTURE');
        try {
          return await action({
            userId: identity.principal.userId,
            actorId: actor.id,
          });
        } catch (error) {
          const response = refusalResponse(error, requestId, [
            'not-found',
            'not-authorized',
            'not-seated',
            'stale-version',
            'command-conflict',
            'illegal-command',
            'freeze-not-ready',
            'ballot-already-submitted',
            'round-decided',
            'attendance-unsettled',
          ]);
          if (!response) throw error;
          return response;
        }
      },
    );
}
