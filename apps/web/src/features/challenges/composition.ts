import type { AuthorizationPrincipal } from '@daisy/auth/authorization';
import { requireAuthorization } from '@daisy/auth/request-authorization';
import type { OwnCollectionFence } from '@daisy/db/authorization';
import type { App } from '../../server/app';
import { memberHttpBoundary } from '../../server/member-boundary';
import { consumeOrThrow } from '../../server/rate-limit';
import { appDiscoverActor } from '../account/username-discovery';
import { requireMemberActor } from '../access/actor';
import { contactPairFence } from '../contacts/authorization';
import { createChallengeHandlers } from './handlers';
import {
  acceptChallenge,
  challengeListOf,
  challengeRateLimit,
  challengeSendLimit,
  endChallenge,
  sendChallenge,
  type ChallengeDependencies,
} from './operations';

const ownList =
  (
    principal: AuthorizationPrincipal,
  ): OwnCollectionFence<{ readonly actorId: string }> =>
  async ({ scope, account }) =>
    requireAuthorization({
      principal,
      capability: 'social.challenge.list',
      resource: { kind: 'challenge_collection', actorId: scope.actorId },
      context: { account },
    });

const ports = (
  app: App,
  principal: AuthorizationPrincipal,
): ChallengeDependencies => ({
  clock: app.clock,
  nextId: () => app.ids.next(),
  limit: (actorId) =>
    consumeOrThrow(
      app.limiter,
      challengeRateLimit.key(actorId),
      challengeRateLimit.rule,
    ),
  limitSend: (actorId) =>
    consumeOrThrow(
      app.limiter,
      challengeSendLimit.key(actorId),
      challengeSendLimit.rule,
    ),
  rankedOpen: async () =>
    (await app.database.listLadderSeasons()).some(
      (season) => season.status === 'active',
    ),
  formatOffered: (format) => app.database.formatInCatalog(format),
  discover: appDiscoverActor(app),
  activity: async (actorId) =>
    (await app.redis.readActorsPresence([actorId])).get(actorId) ?? null,
  store: (capability) =>
    app.database.challengeStore(contactPairFence({ principal, capability })),
  counterpart: (actorId, challengeId) =>
    app.database.readChallengeCounterpart(actorId, challengeId),
});

export function composeChallengeRoutes(app: App) {
  return createChallengeHandlers({
    boundary: memberHttpBoundary(app),
    websocketEndpoint: app.websocketEndpoint,
    list: async (principal) => {
      const { actorId, userId } = requireMemberActor(principal);
      const rows = await app.database.listChallenges(
        { userId, actorId },
        app.clock.now(),
        ownList(principal),
      );
      return { actorId, ...challengeListOf(rows) };
    },
    send: (principal, input) =>
      sendChallenge(principal, input, ports(app, principal)),
    accept: (principal, input) =>
      acceptChallenge(principal, input, ports(app, principal)),
    end: (principal, command, challengeId) =>
      endChallenge(principal, command, challengeId, ports(app, principal)),
  });
}
