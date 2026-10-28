import { createHash } from 'node:crypto';
import {
  authorize,
  participantAccess,
  type ChannelAuthorizationFact,
  type MessagingCollectionAuthorizationFact,
  type SocialAccountFact,
  type SocialPolicyEvidence,
} from '@daisy/auth/authorization';
import { liveParticipantSession } from './participant-session';
import { loadAccountPolicyFacts } from '@daisy/auth/account-policy-facts';
import { bindAuthorizationAgeFact } from '@daisy/db/account-age';
import { loadAuthorizationSession } from '@daisy/db/authorization';
import { parseTopic } from '@daisy/protocol';
import type { Clock } from '@daisy/clock';
import type { RealtimeAuthorityReads } from '@daisy/db';
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
/** One lane's authority reads (admission or renewal, ADR 0088) and the clock. */
export type AuthorityResources = {
  readonly clock: Clock;
  readonly database: RealtimeAuthorityReads;
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
  readonly resources: AuthorityResources;
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
    if (!session || !liveParticipantSession(session, resources.clock.now()))
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
      case 'round':
        return authorizeAudience(
          principal,
          resources.database.readRoundAuthorizationFacts(
            parsed.roundId,
            principal,
          ),
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
  async function authorizeAudience(
    principal: SocketPrincipal,
    projection:
      | ReturnType<RealtimeAuthorityReads['readRoomAuthorizationFacts']>
      | ReturnType<RealtimeAuthorityReads['readRoundAuthorizationFacts']>,
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
      !liveParticipantSession(current, resources.clock.now()) ||
      current?.account.revision !== accountRevision ||
      now() >= bound
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
        const accounts = await loadAccountPolicyFacts({
          accounts: currentAccounts,
          now: resources.clock.now(),
          readAgeFact: bindAuthorizationAgeFact(tx),
        });
        const viewer = await decideChannelViewer({
          tx,
          fact,
          accounts,
          principal,
          ...(readingPolicy ? { readingPolicy } : {}),
          clock: resources.clock,
          deadline,
        });
        if (!viewer || viewer.accountRevision !== accountRevision) return null;
        return {
          revision: fingerprint([...base, viewer.revision]),
          validUntil: Math.min(bound, viewer.validUntil),
        };
      },
    );
    return result && now() < result.validUntil ? result : null;
  }
  return {
    authorizeTopic,
    deadline,
    async validatePrincipal(principal: SocketPrincipal) {
      const session = await resources.database.readAuthorizationSession({
        ...principal,
        now: resources.clock.now(),
      });
      return liveParticipantSession(session, resources.clock.now());
    },
  };
}

/**
 * One viewer's channel decision inside an already fenced read: current
 * session, participant access, reading policy and `channel.subscribe`. The
 * topic subscription and the observation permit evaluator share it, so the
 * channel's policy has one home. `revision` fingerprints every fact the
 * decision depended on; `validUntil` is the earliest of their deadlines.
 */
export async function decideChannelViewer({
  tx,
  fact,
  accounts,
  principal,
  readingPolicy,
  clock,
  deadline,
}: {
  readonly tx: Parameters<typeof loadAuthorizationSession>[0];
  readonly fact: ChannelAuthorizationFact;
  readonly accounts: readonly SocialAccountFact[];
  readonly principal: SocketPrincipal;
  readonly readingPolicy?: RealtimeReadingPolicy;
  readonly clock: { readonly now: () => string };
  readonly deadline: (expiry: string) => number;
}) {
  const current = await loadAuthorizationSession(tx, {
    ...principal,
    now: clock.now(),
  });
  if (!current || !participantAccess(current.account)) return null;
  const instant = clock.now();
  const reading = readingPolicy?.({ channel: fact, accounts, now: instant });
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
    accountRevision: current.account.revision,
    revision: [
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
    ],
    validUntil: Math.min(
      deadline(current.expiresAt),
      deadline(reading.validUntil),
      ...ageDeadlines,
    ),
  };
}
