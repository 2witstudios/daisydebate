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
  ObservationAuthorityDecision,
  ObservationDependency,
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
        scope: 'subject',
        revision: String(input.account.revision),
        nextBoundary: null,
      },
    ];
    if (fact.kind === 'messaging_collection')
      return inbox(input, fact, dependencies);
    if (fact.kind === 'channel') return channel(input, [], readingPolicy);
    return competitive(input, fact, dependencies);
  };
}
function inbox(
  input: ObservationAuthorityContext,
  fact: MessagingCollectionAuthorizationFact,
  dependencies: ObservationDependency[],
): ObservationAuthorityDecision {
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
function competitive(
  input: ObservationAuthorityContext,
  fact: RoomAuthorizationFact | RoundAuthorizationFact,
  dependencies: ObservationDependency[],
): ObservationAuthorityDecision {
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
    scope: 'entitlement',
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
}
/** Every active cast member's account and age facts bound the shared cohort. */
function castDependencies(
  accounts: readonly SocialAccountFact[],
  dependencies: ObservationDependency[],
  boundaries: string[],
) {
  for (const row of accounts) {
    if (row.account.actorId === null) return false;
    dependencies.push(
      {
        key: `account-${row.account.actorId}`,
        scope: 'cohort',
        revision: String(row.account.revision),
        nextBoundary: null,
      },
      {
        key: `age-${row.account.actorId}`,
        scope: 'cohort',
        revision:
          row.age.state === 'known'
            ? JSON.stringify([
                row.age.revision,
                row.age.band,
                row.age.accountRevision,
              ])
            : JSON.stringify(['unknown', row.account.revision]),
        nextBoundary: row.age.state === 'known' ? row.age.validUntil : null,
      },
    );
    if (row.age.state === 'known') boundaries.push(row.age.validUntil);
  }
  return true;
}
function channelDependencies(fact: ChannelAuthorizationFact) {
  const authority: ObservationDependency =
    fact.authority.kind === 'dm'
      ? {
          key: `contact-${fact.authority.lowActorId}-${fact.authority.highActorId}`,
          scope: 'cohort',
          revision: String(fact.authority.revision),
          nextBoundary: null,
        }
      : {
          key: `grant-${fact.channelId}-${fact.authority.actorId}`,
          scope: 'entitlement',
          revision: JSON.stringify([
            fact.authority.role,
            fact.authority.generation,
          ]),
          nextBoundary: null,
        };
  return [
    {
      key: `channel-${fact.channelId}`,
      scope: 'entitlement',
      revision: String(fact.revision),
      nextBoundary: null,
    },
    {
      key: `policy-${fact.policyKey}`,
      scope: 'cohort',
      revision: String(fact.policyRevision),
      nextBoundary: null,
    },
    authority,
  ] satisfies ObservationDependency[];
}
/** Dependency keys are unique per decision; code-point order is canonical. */
const byKey = (left: ObservationDependency, right: ObservationDependency) =>
  left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
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
  if (!castDependencies(accounts, dependencies, boundaries))
    return { status: 'unavailable' } as const;
  dependencies.push(...channelDependencies(fact));
  const deadline = boundaries.reduce((left, right) =>
    Date.parse(left) < Date.parse(right) ? left : right,
  );
  if (!(Date.parse(deadline) > Date.parse(input.databaseNow)))
    return { status: 'unavailable' } as const;
  return {
    status: 'allowed',
    partition: { kind: 'shared', policyKey: 'channel-messages-v1' },
    dependencies: dependencies.sort(byKey),
    eligibleUntil: deadline,
    overlay: null,
  } as const;
}
