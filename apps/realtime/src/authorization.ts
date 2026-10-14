import { createHash } from 'node:crypto';
import {
  authorize,
  type MessagingCollectionAuthorizationFact,
} from '@daisy/auth/authorization';
import { parseTopic } from '@daisy/protocol';
import type { RealtimeApp } from './app';
import type { SocketPrincipal } from './registry';

export type SubscriptionAuthority = {
  readonly revision: string;
  readonly validUntil: number;
};
const fingerprint = (value: unknown) =>
  createHash('sha3-256').update(JSON.stringify(value)).digest('hex');

/** The application composes canonical decisions and existing producer pools.
 * No topic payload, cursor, preference or cached revision grants authority.
 */
export function createRealtimeAuthorization({
  resources,
  now,
}: {
  readonly resources: RealtimeApp;
  readonly now: () => number;
}) {
  const deadline = (expiry: string) =>
    now() + Math.max(0, Date.parse(expiry) - Date.parse(resources.clock.now()));
  async function authorizeTopic(
    principal: SocketPrincipal,
    topic: string,
  ): Promise<SubscriptionAuthority | null> {
    const parsed = parseTopic(topic);
    // Channel signals ride the socket's channel observation permit.
    if (!parsed || parsed.family === 'channel') return null;
    const started = now();
    const session = await resources.database.readAuthorizationSession({
      ...principal,
      now: resources.clock.now(),
    });
    if (
      !session ||
      Date.parse(session.expiresAt) <= Date.parse(resources.clock.now())
    )
      return null;
    const base = [
      principal.sessionId,
      principal.userId,
      principal.actorId,
      session.account.revision,
      session.expiresAt,
    ];
    const bound = Math.min(started + 60_000, deadline(session.expiresAt));
    if (parsed.family === 'user:inbox')
      return authorize({
        principal: { kind: 'user', ...principal },
        capability: 'channel.inbox.read',
        resource: {
          kind: 'messaging_collection',
          actorId: parsed.actorId,
        } satisfies MessagingCollectionAuthorizationFact,
        context: { account: session.account },
      }).allow
        ? { revision: fingerprint(base), validUntil: bound }
        : null;
    if (parsed.family === 'standings')
      return { revision: fingerprint(base), validUntil: bound };
    switch (parsed.family) {
      case 'room':
        return authorizeAudience(
          principal,
          resources.database.readRoomAuthorizationFacts(
            parsed.roomId,
            principal,
          ),
          session.account.revision,
          base,
          bound,
        );
      case 'debate':
        return authorizeAudience(
          principal,
          resources.database.readRoundAuthorizationFacts(
            parsed.debateId,
            principal,
          ),
          session.account.revision,
          base,
          bound,
        );
      default:
        return null;
    }
  }
  async function authorizeAudience(
    principal: SocketPrincipal,
    projection:
      | ReturnType<RealtimeApp['database']['readRoomAuthorizationFacts']>
      | ReturnType<RealtimeApp['database']['readRoundAuthorizationFacts']>,
    accountRevision: number,
    base: readonly unknown[],
    bound: number,
  ): Promise<SubscriptionAuthority | null> {
    const facts = await projection;
    if (!facts?.account || facts.account.revision !== accountRevision)
      return null;
    const decision = authorize({
      principal: { kind: 'user', ...principal },
      capability: facts.resource.kind === 'round' ? 'round.read' : 'room.read',
      resource: facts.resource,
      context: { account: facts.account },
    });
    if (!decision.allow) return null;
    const current = await resources.database.readAuthorizationSession({
      ...principal,
      now: resources.clock.now(),
    });
    if (
      !current ||
      current.account.revision !== accountRevision ||
      Date.parse(current.expiresAt) <= Date.parse(resources.clock.now()) ||
      now() >= bound
    )
      return null;
    return {
      revision: fingerprint([...base, facts.resource.revision]),
      validUntil: Math.min(bound, deadline(current.expiresAt)),
    };
  }
  return {
    authorizeTopic,
    async validatePrincipal(principal: SocketPrincipal) {
      const session = await resources.database.readAuthorizationSession({
        ...principal,
        now: resources.clock.now(),
      });
      return (
        session !== null &&
        Date.parse(session.expiresAt) > Date.parse(resources.clock.now())
      );
    },
  };
}
