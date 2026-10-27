import type { Database } from '@daisy/db';
import type { Logger } from '@daisy/logger';
import type { createMediaWorkerAuthentication } from '@daisy/media/internal';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { z } from 'zod';
import { handleOperation, parseValidated } from '../../server/http';
import { readSignedWorkerRequest } from '../../server/media-worker-ingress';
import type { ListenerIdentity } from './activity-relay';

type Listener = Pick<
  Database,
  'claimBotListenerLease' | 'readBotListenerState'
>;
const listenerScope = z.strictObject({
  roundId: idSchema,
  sessionId: idSchema,
  workerId: idSchema,
  epoch: z.number().int().positive().max(2147483647),
});

/**
 * The bot listener's private ingress (ISSUE-764): only a principal signed as
 * the bot-listener role reaches it, and only its own lease, read and
 * activity relay. Capture's routes and authority are not here.
 */
export function createBotListenerHandlers(input: {
  readonly logger: Logger;
  readonly authentication: () => ReturnType<
    typeof createMediaWorkerAuthentication
  >;
  readonly listener: () => Listener;
  readonly activity: (
    identity: ListenerIdentity,
    body: unknown,
  ) => Promise<void>;
}) {
  return {
    handle: (request: Request) =>
      handleOperation(input.logger, request, 'media.bot_listener', async () => {
        const { payload, operation } = await readSignedWorkerRequest(
          request,
          input.authentication(),
          'bot-listener',
        );
        if (operation === 'activity') {
          const { roundId, sessionId, workerId, epoch, ...body } = payload;
          await input.activity(
            parseValidated(listenerScope, {
              roundId,
              sessionId,
              workerId,
              epoch,
            }),
            body,
          );
          return Response.json(null);
        }
        const listener = input.listener();
        if (operation === 'lease')
          return Response.json(await listener.claimBotListenerLease(payload));
        if (operation === 'read')
          return Response.json(await listener.readBotListenerState(payload));
        throw createAppError('AUTHORIZATION');
      }),
  };
}
