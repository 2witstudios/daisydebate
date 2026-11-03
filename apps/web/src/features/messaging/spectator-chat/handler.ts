import type { Clock, IdGenerator } from '@daisy/clock';
import type { Database } from '@daisy/db';
import { createAppError, createRefusal } from '@daisy/errors';
import { spectatorChatPostSchema } from '@daisy/protocol';
import {
  accountRoute,
  roundIdOf,
  type AccountRouteDeps,
} from '../../../server/account-route';
import { parseValidated } from '../../../server/http';
import { requestAdmits } from '../../audience-link/audience-link';
import { planSpectatorPost, spectatorChatRefusals } from './post-decision';

const MAX_BODY_BYTES = 4096;
/** In front of slow mode, which an operator sets per Broadcast. */
const CHAT_LIMIT = { max: 20, windowSeconds: 60 };

/**
 * POST /api/rounds/:id/chat: an account posts to the Round's spectator channel.
 * The answer names only the message, which readers get at their next read. A
 * Round this request cannot reach answers as missing. An account with no username has no actor, and no name to post under.
 */
export const createSpectatorChatRoute = (
  deps: AccountRouteDeps & {
    readonly store: Pick<Database, 'postSpectatorChatMessage'>;
    readonly clock: Pick<Clock, 'now'>;
    readonly ids: Pick<IdGenerator, 'next'>;
  },
) => {
  return (request: Request) =>
    accountRoute(
      deps,
      {
        operation: 'audience.chat',
        limit: CHAT_LIMIT,
        maxBodyBytes: MAX_BODY_BYTES,
        refusals: [...spectatorChatRefusals, 'chat-needs-username'],
      },
      async ({ identity, body }) => {
        const { userId, actorId } = identity.principal;
        if (actorId === null)
          throw createRefusal('CONFLICT', 'chat-needs-username');
        const post = parseValidated(spectatorChatPostSchema, body);
        const roundId = roundIdOf(request);
        const message = await deps.store.postSpectatorChatMessage(
          {
            roundId,
            admit: requestAdmits(request, roundId),
            userId,
            actorId,
            newChannelId: deps.ids.next(),
            command: post,
          },
          (facts, state) =>
            planSpectatorPost(
              facts,
              state,
              { ...post, channelId: state.counters.channelId },
              {
                actorId,
                messageId: state.receipt?.messageId ?? deps.ids.next(),
                now: deps.clock.now(),
              },
            ),
        );
        if (message === null) throw createAppError('NOT_FOUND');
        return Response.json({ messageId: message.id });
      },
    )(request);
};
