import { createHash } from 'node:crypto';
import type { ServerMessage } from '@daisy/protocol';
import type { RealtimeApp } from './app';
import {
  createRealtimeAuthorization,
  type RealtimeReadingPolicy,
} from './authorization';
import { createSubscriptionRegistry } from './registry';
import type { SocketPrincipal } from './registry';
import { createAdmission } from './admission';
import { boundedAuthorityCheck } from './authority-check';
import type { IntervalTimers } from './outbox-drain';

/** The real process composition: Redis atomic ticket consumption, canonical
 * durable session/account and topic authority, retained database catchup.
 */
export function createRealtimeDelivery({
  resources,
  now,
  publish,
  readingPolicy,
  timers,
}: {
  readonly timers: IntervalTimers;
  readonly resources: RealtimeApp;
  readonly now: () => number;
  readonly publish: (topic: string, frame: ServerMessage) => void;
  readonly readingPolicy?: RealtimeReadingPolicy;
}) {
  const authority = createRealtimeAuthorization({
    resources,
    now,
    ...(readingPolicy ? { readingPolicy } : {}),
  });
  const tuning = resources.transport ?? {
    maxPerIp: 20,
    maxUnauthenticated: 4,
    maxPerActor: 8,
    ringLimit: 2_000,
    maxSubscriptions: 64,
    allowedOrigins: [],
  };
  const registry = createSubscriptionRegistry({
    now,
    lifetimeMs: 60_000,
    ringLimit: tuning.ringLimit,
    maxSubscriptions: tuning.maxSubscriptions,
    authorize: (principal, topic) =>
      boundedAuthorityCheck({
        check: () => authority.authorizeTopic(principal, topic),
        denied: null,
        timers,
        budgetMs: 5_000,
      }),
    readCatchup: resources.database.readOutboxCatchup,
    readRetentionBoundary: resources.database.readOutboxRetentionBoundary,
    publish,
  });
  return {
    registry,
    admission: createAdmission({ now, ...tuning }),
    validatePrincipal: (principal: SocketPrincipal) =>
      boundedAuthorityCheck({
        check: () => authority.validatePrincipal(principal),
        denied: false,
        timers,
        budgetMs: 5_000,
      }),
    async authenticate(
      ticket: string,
      origin: string,
    ): Promise<SocketPrincipal | null> {
      const digest = createHash('sha3-256').update(ticket).digest('hex');
      const binding = await resources.redis.consumeConnectTicket(
        digest,
        origin,
      );
      if (!binding.accepted) return null;
      const session = await resources.database.resolveRealtimeSession({
        actorId: binding.actorId,
        sessionId: binding.sessionId,
        now: resources.clock.now(),
      });
      if (
        !session ||
        Date.parse(session.expiresAt) <= Date.parse(resources.clock.now())
      )
        return null;
      return {
        actorId: session.actorId,
        userId: session.userId,
        sessionId: session.sessionId,
      };
    },
  };
}
