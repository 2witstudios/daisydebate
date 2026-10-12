import { authorize } from './authorization';
import type {
  AccountAuthorizationFact,
  AuthorizationPrincipal,
  RoomAuthorizationFact,
  RoundAuthorizationFact,
  ChannelAuthorizationFact,
  MessagingCollectionAuthorizationFact,
  SocialAccountFact,
  SocialPolicyEvidence,
} from './authorization';
import type {
  ObservationPartition,
  ObservationResource,
} from '@daisy/protocol';
export type ObservationAuthorityContext = {
  readonly principal: Extract<AuthorizationPrincipal, { kind: 'user' }> & {
    readonly actorId: string;
  };
  readonly resource: ObservationResource;
  readonly account: AccountAuthorizationFact;
  readonly resourceFact:
    | RoomAuthorizationFact
    | RoundAuthorizationFact
    | ChannelAuthorizationFact
    | MessagingCollectionAuthorizationFact;
  readonly socialAccounts?: readonly SocialAccountFact[];
  readonly databaseNow: string;
};
export type ObservationDependency = {
  readonly key: string;
  readonly revision: string;
  readonly nextBoundary: string | null;
};
export type ObservationAuthorityDecision =
  | {
      readonly status: 'allowed';
      readonly partition: ObservationPartition;
      readonly dependencies: readonly ObservationDependency[];
      readonly eligibleUntil: string | null;
      readonly overlay: unknown;
    }
  | { readonly status: 'denied' | 'unavailable' };
export type ObservationReadingPolicy = (input: {
  readonly channel: ChannelAuthorizationFact;
  readonly accounts: readonly SocialAccountFact[];
  readonly now: string;
}) => SocialPolicyEvidence | undefined;
type DecideObservationAuthority = (
  input: ObservationAuthorityContext,
) => ObservationAuthorityDecision;

/** Canonical policy remains injected and pure; storage/transport never decide grants. */
export function createObservationAuthorityDecision({
  readingPolicy,
}: {
  readonly readingPolicy?: ObservationReadingPolicy;
}): DecideObservationAuthority {
  return (input) => {
    const fact = input.resourceFact;
    const dependencies: ObservationDependency[] = [
      {
        key: `account-${input.principal.actorId}`,
        revision: String(input.account.revision),
        nextBoundary: null,
      },
    ];
    if (fact.kind === 'messaging_collection') {
      if (input.resource.kind !== 'inbox' || input.resource.id !== fact.actorId)
        return { status: 'denied' };
      if (
        !authorize({
          principal: input.principal,
          capability: 'channel.inbox.read',
          resource: fact,
          context: { account: input.account, now: input.databaseNow },
        }).allow
      )
        return { status: 'denied' };
      return {
        status: 'allowed',
        partition: { kind: 'actor', actorId: fact.actorId },
        dependencies,
        eligibleUntil: null,
        overlay: null,
      };
    }
    if (fact.kind === 'channel')
      return channel(input, dependencies, readingPolicy);
    const id = fact.kind === 'room' ? fact.roomId : fact.roundId;
    if (input.resource.kind !== fact.kind || input.resource.id !== id)
      return { status: 'denied' };
    const capability = fact.kind === 'room' ? 'room.read' : 'round.read';
    if (
      !authorize({
        principal: input.principal,
        capability,
        resource: fact,
        context: { account: input.account, now: input.databaseNow },
      }).allow
    )
      return { status: 'denied' };
    dependencies.push({
      key: `${fact.kind}-${id}`,
      revision: String(fact.revision),
      nextBoundary: null,
    });
    return {
      status: 'allowed',
      partition: {
        kind: 'shared',
        policyKey: fact.kind === 'room' ? 'room-safe-v1' : 'round-clock-v1',
      },
      dependencies,
      eligibleUntil: null,
      overlay: null,
    };
  };
}
function channel(
  input: ObservationAuthorityContext,
  dependencies: ObservationDependency[],
  readingPolicy: ObservationReadingPolicy | undefined,
) {
  const fact = input.resourceFact;
  if (
    fact.kind !== 'channel' ||
    input.resource.kind !== 'channel' ||
    input.resource.id !== fact.channelId
  )
    return { status: 'denied' } as const;
  const accounts = input.socialAccounts;
  if (!readingPolicy || !accounts) return { status: 'unavailable' } as const;
  const reading = readingPolicy({
    channel: fact,
    accounts,
    now: input.databaseNow,
  });
  if (!reading) return { status: 'unavailable' } as const;
  const allowed = authorize({
    principal: input.principal,
    capability: 'channel.subscribe',
    resource: fact,
    context: {
      account: input.account,
      socialAccounts: accounts,
      socialReading: reading,
      now: input.databaseNow,
    },
  }).allow;
  if (!allowed) return { status: 'denied' } as const;
  const boundaries = [reading.validUntil];
  for (const row of accounts) {
    if (row.account.actorId === null || row.age.state !== 'known')
      return { status: 'unavailable' } as const;
    dependencies.push(
      {
        key: `account-${row.account.actorId}`,
        revision: String(row.account.revision),
        nextBoundary: null,
      },
      {
        key: `age-${row.account.actorId}`,
        revision: JSON.stringify([
          row.age.revision,
          row.age.band,
          row.age.accountRevision,
        ]),
        nextBoundary: row.age.validUntil,
      },
    );
    boundaries.push(row.age.validUntil);
  }
  dependencies.push(
    {
      key: `channel-${fact.channelId}`,
      revision: String(fact.revision),
      nextBoundary: null,
    },
    {
      key: `policy-${fact.policyKey}`,
      revision: String(fact.policyRevision),
      nextBoundary: null,
    },
  );
  if (fact.authority.kind === 'dm')
    dependencies.push({
      key: `contact-${fact.authority.lowActorId}-${fact.authority.highActorId}`,
      revision: String(fact.authority.revision),
      nextBoundary: null,
    });
  const deadline = boundaries.reduce((left, right) =>
    Date.parse(left) < Date.parse(right) ? left : right,
  );
  if (!(Date.parse(deadline) > Date.parse(input.databaseNow)))
    return { status: 'unavailable' } as const;
  return {
    status: 'allowed',
    partition: { kind: 'shared', policyKey: 'channel-messages-v1' },
    dependencies,
    eligibleUntil: deadline,
    overlay: null,
  } as const;
}
