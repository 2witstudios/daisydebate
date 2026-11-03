import { z } from 'zod';
import { idSchema } from '@daisy/protocol';
import { parseValidated, readJson } from '../../server/http';
import {
  runMemberRoute,
  type BudgetedMemberBoundary,
} from '../../server/member-boundary';
import { isMediaDeferred, type createRoundMediaOperations } from './operations';

type Operations = Pick<
  ReturnType<typeof createRoundMediaOperations>,
  'session' | 'read' | 'reconcile'
>;
const emptyBody = z.strictObject({});
/** Expected backpressure: retryable for the client, and no alert for anyone. */
const deferred = (logger: Pick<BudgetedMemberBoundary['logger'], 'log'>) => {
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
  d: BudgetedMemberBoundary & {
    readonly operations: () => Operations;
  },
) {
  const run =
    (operation: keyof Operations) => (request: Request, rawRoundId: string) =>
      runMemberRoute(
        d,
        request,
        {
          name: `round.media.${operation}`,
          readOnly: operation === 'read',
          bucket: `round:media:${operation}`,
          rule: {
            max: operation === 'session' ? 30 : 240,
            windowSeconds: 60,
          },
        },
        async ({ actorId }, { logger }) => {
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
      );
  return {
    read: run('read'),
    session: run('session'),
    reconcile: run('reconcile'),
  };
}
