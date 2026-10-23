import { z } from 'zod';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { consumeOrThrow } from '../auth/abuse/rate-limit';
import {
  handleOperation,
  parseValidated,
  readJson,
  requireSameOrigin,
  requireSameOriginRead,
  requireSignedIn,
} from '../../server/http';
import type { createRoundHandlers } from '../round-runtime/handlers';
import type { createRoundMediaOperations } from './operations';

type Operations = Pick<
  ReturnType<typeof createRoundMediaOperations>,
  'session' | 'read' | 'reconcile'
>;
const emptyBody = z.strictObject({});
/** Human session boundary only. Internal workers have a separate signed ingress. */
export function createRoundMediaHandlers(
  d: Pick<
    Parameters<typeof createRoundHandlers>[0],
    'logger' | 'identify' | 'origin' | 'getActorByUserId' | 'limiter'
  > & {
    readonly active: () => boolean;
    readonly operations: () => Operations;
  },
) {
  const run =
    (operation: keyof Operations) => (request: Request, rawRoundId: string) =>
      handleOperation(
        d.logger,
        request,
        `round.media.${operation}`,
        async () => {
          if (!d.active()) throw createAppError('NOT_FOUND');
          if (operation === 'read') requireSameOriginRead(request, d.origin());
          else requireSameOrigin(request, d.origin());
          const identity = requireSignedIn(await d.identify(request));
          if (identity.state !== 'member')
            throw createAppError('AUTHORIZATION');
          await consumeOrThrow(
            d.limiter(),
            `round:media:${operation}:${identity.principal.userId}`,
            { max: operation === 'session' ? 30 : 240, windowSeconds: 60 },
          );
          const actor = await d.getActorByUserId(identity.principal.userId);
          if (!actor || actor.id !== identity.principal.actorId)
            throw createAppError('INFRASTRUCTURE');
          const roundId = parseValidated(idSchema, rawRoundId);
          if (operation !== 'read')
            parseValidated(emptyBody, await readJson(request, 128));
          const body = await d.operations()[operation](roundId, actor.id);
          return Response.json(body, {
            headers: { 'Cache-Control': 'no-store' },
          });
        },
      );
  return {
    read: run('read'),
    session: run('session'),
    reconcile: run('reconcile'),
  };
}
