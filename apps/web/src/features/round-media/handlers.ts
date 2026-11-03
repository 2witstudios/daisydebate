import { z } from 'zod';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  handleOperation,
  parseValidated,
  readJson,
  requireSameOrigin,
  requireSameOriginRead,
} from '../../server/http';
import { requireMember } from '../../server/member-gate';
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
) => {
  logger.log(
    'round.media.request_deferred',
    { errorCode: 'INFRASTRUCTURE' },
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
        async (_id, logger) => {
          if (!d.active()) throw createAppError('NOT_FOUND');
          if (operation === 'read') requireSameOriginRead(request, d.origin());
          else requireSameOrigin(request, d.origin());
          const { actorId } = await requireMember(d, request, {
            bucket: `round:media:${operation}`,
            rule: {
              max: operation === 'session' ? 30 : 240,
              windowSeconds: 60,
            },
          });
          const roundId = parseValidated(idSchema, rawRoundId);
          if (operation !== 'read')
            parseValidated(emptyBody, await readJson(request, 128));
          const operations = d.operations();
          const body =
            operation === 'read'
              ? await operations.read(roundId, actorId)
              : await operations[operation](
                  roundId,
                  actorId,
                  request.signal,
                ).catch((error: unknown) => {
                  if (!isMediaDeferred(error) || request.signal.aborted)
                    throw error;
                  return deferred(logger);
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
