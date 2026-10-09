import { createHash } from 'node:crypto';
import {
  authorize,
  type ChannelAuthorizationFact,
  type SocialAccountFact,
  type SocialPolicyEvidence,
} from '@daisy/auth/authorization';
import { loadAccountPolicyFacts } from '@daisy/auth/account-policy-facts';
import { loadAuthorizationAgeFact } from '@daisy/db/account-age';
import { loadAuthorizationSession } from '@daisy/db/authorization';
import { parseTopic } from '@daisy/protocol';
import type { RealtimeApp } from './app';
import type { SocketPrincipal } from './registry';

export type RealtimeReadingPolicy = (input: {
  readonly channel: ChannelAuthorizationFact;
  readonly accounts: readonly SocialAccountFact[];
  readonly now: string;
}) => SocialPolicyEvidence | undefined;
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
  readingPolicy,
}: {
  readonly resources: RealtimeApp;
  readonly now: () => number;
  readonly readingPolicy?: RealtimeReadingPolicy;
}) {
  const deadline = (expiry: string) =>
    now() + Math.max(0, Date.parse(expiry) - Date.parse(resources.clock.now()));
  async function authorizeTopic(
    principal: SocketPrincipal,
    topic: string,
  ): Promise<SubscriptionAuthority | null> {
    const parsed = parseTopic(topic);
    if (!parsed) return null;
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
      return parsed.actorId === principal.actorId
        ? { revision: fingerprint(base), validUntil: bound }
        : null;
    if (parsed.family === 'standings')
      return { revision: fingerprint(base), validUntil: bound };
    switch (parsed.family) {
      case 'room':
        return authorizeRoom(
          principal,
          parsed.roomId,
          session.account.revision,
          base,
          bound,
        );
      case 'channel':
        return authorizeChannel(
          principal,
          parsed.channelId,
          session.account.revision,
          base,
          bound,
        );
      default:
        return null;
    }
  }
  async function authorizeRoom(
    principal: SocketPrincipal,
    roomId: string,
    accountRevision: number,
    base: readonly unknown[],
    bound: number,
  ): Promise<SubscriptionAuthority | null> {
    const facts = await resources.database.readRoomAuthorizationFacts(
      roomId,
      principal,
    );
    if (!facts || facts.account.revision !== accountRevision) return null;
    const decision = authorize({
      principal: { kind: 'user', ...principal },
      capability: 'room.read',
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
      facts.account.revision !== current.account.revision
    )
      return null;
    return {
      revision: fingerprint([...base, facts.resource.revision]),
      validUntil: Math.min(bound, deadline(current.expiresAt)),
    };
  }
  async function authorizeChannel(
    principal: SocketPrincipal,
    channelId: string,
    accountRevision: number,
    base: readonly unknown[],
    bound: number,
  ): Promise<SubscriptionAuthority | null> {
    const result = await resources.database.messagingChannelAuthority(
      { ...principal, channelId: channelId },
      async ({ tx, fact, accounts: currentAccounts }) => {
        const factNow = resources.clock.now();
        const accounts = await loadAccountPolicyFacts({
          accounts: currentAccounts,
          now: factNow,
          readAgeFact: (account, checkedAt) =>
            account.actorId
              ? loadAuthorizationAgeFact(tx, {
                  userId: account.userId,
                  actorId: account.actorId,
                  accountRevision: account.revision,
                  now: checkedAt,
                })
              : Promise.resolve({ state: 'unknown' }),
        });
        const current = await loadAuthorizationSession(tx, {
          ...principal,
          now: resources.clock.now(),
        });
        if (!current || current.account.revision !== accountRevision)
          return null;
        const instant = resources.clock.now();
        const reading = readingPolicy?.({
          channel: fact,
          accounts,
          now: instant,
        });
        const decision = authorize({
          principal: { kind: 'user', ...principal },
          capability: 'channel.subscribe',
          resource: fact,
          context: {
            account: current.account,
            socialAccounts: accounts,
            now: instant,
            ...(reading ? { socialReading: reading } : {}),
          },
        });
        if (!decision.allow || !reading) return null;
        const ageDeadlines = accounts.flatMap((row) =>
          row.age.state === 'known' ? [deadline(row.age.validUntil)] : [],
        );
        return {
          revision: fingerprint([
            ...base,
            fact.revision,
            fact.policyRevision,
            fact.authority,
            accounts.map((row) => [
              row.account.actorId,
              row.account.revision,
              row.age.state === 'known' ? row.age.revision : null,
            ]),
            reading.authorityRevision,
            reading.relationshipRevision,
          ]),
          validUntil: Math.min(
            bound,
            deadline(current.expiresAt),
            deadline(reading.validUntil),
            ...ageDeadlines,
          ),
        };
      },
    );
    return result && now() < result.validUntil ? result : null;
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
