import { createHash } from 'node:crypto';
import {
  authorize,
  type ChannelAuthorizationFact,
  type SocialAccountFact,
  type SocialPolicyEvidence,
} from '@daisy/auth/authorization';
import { loadAccountPolicyFacts } from '@daisy/auth/account-policy-facts';
import { loadAccountAgeSource } from '@daisy/db/account-age';
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
    if (parsed.family === 'room') {
      let revision: number | undefined;
      await resources.database.readRoomAssembly(
        parsed.roomId,
        principal,
        (state, account) => {
          const decision = authorize({
            principal: { kind: 'user', ...principal },
            capability: 'room.read',
            resource: {
              ...state,
              kind: 'room',
              roomId: state.id,
              revision: state.version,
            },
            context: { account },
          });
          if (decision.allow) revision = state.version;
          return decision.allow;
        },
      );
      const current = await resources.database.readAuthorizationSession({
        ...principal,
        now: resources.clock.now(),
      });
      if (
        !current ||
        current.account.revision !== session.account.revision ||
        revision === undefined
      )
        return null;
      return {
        revision: fingerprint([...base, revision]),
        validUntil: Math.min(bound, deadline(current.expiresAt)),
      };
    }
    if (parsed.family !== 'channel') return null;
    let result: SubscriptionAuthority | null = null;
    const store = resources.database.messagingChannelStore(
      async (tx, _input, frame) => {
        const accounts = await loadAccountPolicyFacts({
          accounts: frame.accounts,
          now: resources.clock.now(),
          readAgeSource: (userId) => loadAccountAgeSource(tx, userId),
        });
        const current = await loadAuthorizationSession(tx, {
          ...principal,
          now: resources.clock.now(),
        });
        if (!current || current.account.revision !== session.account.revision)
          throw new Error('Subscription refused');
        const instant = resources.clock.now();
        const reading = readingPolicy?.({
          channel: frame.fact,
          accounts,
          now: instant,
        });
        const decision = authorize({
          principal: { kind: 'user', ...principal },
          capability: 'channel.subscribe',
          resource: frame.fact,
          context: {
            account: current.account,
            socialAccounts: accounts,
            now: instant,
            ...(reading ? { socialReading: reading } : {}),
          },
        });
        if (!decision.allow || !reading)
          throw new Error('Subscription refused');
        const ageDeadlines = accounts.flatMap((row) =>
          row.age.state === 'known' ? [deadline(row.age.validUntil)] : [],
        );
        result = {
          revision: fingerprint([
            ...base,
            frame.fact.revision,
            frame.fact.policyRevision,
            frame.fact.authority,
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
    await store.withChannel(
      { ...principal, channelId: parsed.channelId },
      async (frame) => {
        await frame.authorize();
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
