import { z } from 'zod';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { consumeOrThrow } from '../../server/rate-limit';
import {
  handleOperation,
  parseValidated,
  readJson,
  requireSameOrigin,
  requireSameOriginRead,
  requireSignedIn,
} from '../../server/http';
import type { createRoundHandlers } from '../round-runtime/handlers';
import { isMediaDeferred, type createRoundMediaOperations } from './operations';

type Operations = Pick<
  ReturnType<typeof createRoundMediaOperations>,
  'session' | 'read' | 'reconcile'
>;
const emptyBody = z.strictObject({});
/** Expected backpressure: retryable for the client, and no alert for anyone. */
const deferred = (
  logger: Pick<Parameters<typeof createRoundHandlers>[0]['logger'], 'log'>,
  operation: string,
) => {
  logger.log(
    'round.media.request_deferred',
    { operation: `round.media.${operation}`, errorCode: 'INFRASTRUCTURE' },
    'Media request deferred; the client retries',
  );
  return new Response(null, {
    status: 503,
    headers: { 'Cache-Control': 'no-store', 'Retry-After': '1' },
  });
};
/** Human session boundary only. Internal workers have a separate signed ingress. */
export function createRoundMediaHandlers(
  d: Pick<
    Parameters<typeof createRoundHandlers>[0],
    | 'logger'
    | 'reporter'
    | 'identify'
    | 'origin'
    | 'getActorByUserId'
    | 'limiter'
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
          const operations = d.operations();
          const body =
            operation === 'read'
              ? await operations.read(roundId, actor.id)
              : await operations[operation](
                  roundId,
                  actor.id,
                  request.signal,
                ).catch((error: unknown) => {
                  if (!isMediaDeferred(error) || request.signal.aborted)
                    throw error;
                  return deferred(d.logger, operation);
                });
          if (body instanceof Response) return body;
          return Response.json(body, {
            headers: { 'Cache-Control': 'no-store' },
          });
        },
        d.reporter,
      );
  return {
    read: run('read'),
    session: run('session'),
    reconcile: run('reconcile'),
  };
}
