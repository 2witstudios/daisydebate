import type { Clock, IdGenerator } from '@daisy/clock';
import type { Database } from '@daisy/db';
import { createAppError, createRefusal } from '@daisy/errors';
import { audienceReactionPostSchema } from '@daisy/protocol';
import {
  audienceRoute,
  roundIdOf,
  type AccountRouteDeps,
} from '../../server/account-route';
import { parseValidated } from '../../server/http';
import { requestAdmits } from '../audience-link/audience-link';
import { decideChatPost } from '../content-moderation/chat-post';

/** One press of one reaction per account in each window; repeats are one. */
const REACTION_WINDOW_MS = 10_000;
const REACTION_LIMIT = { max: 60, windowSeconds: 60 };

const audienceReactionRefusals = [
  'reactions-unavailable',
  'reactions-closed',
  'reactions-banned',
] as const;

/** The start of the window a press falls in. */
export const reactionWindowOf = (at: string) =>
  new Date(
    Math.floor(Date.parse(at) / REACTION_WINDOW_MS) * REACTION_WINDOW_MS,
  ).toISOString();

/** A ban covers all audience interaction; a Broadcast must be on to react to. */
export const refuseAudienceReaction = (facts: {
  readonly broadcastOpen: boolean | null;
  readonly banned: boolean;
}) => {
  const verdict = decideChatPost({
    banned: facts.banned,
    slowModeSeconds: 0,
    lastPostAtMs: null,
    nowMs: 0,
  });
  if (verdict.kind === 'banned')
    throw createRefusal('CONFLICT', 'reactions-banned');
  if (facts.broadcastOpen === null)
    throw createRefusal('CONFLICT', 'reactions-unavailable');
  if (!facts.broadcastOpen) throw createRefusal('CONFLICT', 'reactions-closed');
};

/** POST /api/rounds/:id/reactions: an account reacts to the Round. */
export const createAudienceReactionRoute = (
  deps: AccountRouteDeps & {
    readonly store: Pick<Database, 'recordAudienceReaction'>;
    readonly clock: Pick<Clock, 'now'>;
    readonly ids: Pick<IdGenerator, 'next'>;
  },
) => {
  return (request: Request) =>
    audienceRoute(
      deps,
      {
        operation: 'audience.reaction',
        limit: REACTION_LIMIT,
        maxBodyBytes: 256,
        refusals: audienceReactionRefusals,
      },
      async ({ identity, body }) => {
        const { kind } = parseValidated(audienceReactionPostSchema, body);
        const at = deps.clock.now();
        const roundId = roundIdOf(request);
        const recorded = await deps.store.recordAudienceReaction(
          {
            id: deps.ids.next(),
            roundId,
            userId: identity.principal.userId,
            actorId: identity.principal.actorId,
            admit: requestAdmits(request, roundId),
            kind,
            at,
            spacedAt: reactionWindowOf(at),
          },
          refuseAudienceReaction,
        );
        if (recorded === null) throw createAppError('NOT_FOUND');
        return Response.json({ received: true });
      },
    )(request);
};
