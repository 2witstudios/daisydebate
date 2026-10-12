import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  createObservationAuthorityDecision,
  type ObservationAuthorityContext,
  type ObservationReadingPolicy,
} from './observation';
setupRitewayBun();
const actor = 'a'.repeat(24),
  peer = 'b'.repeat(24),
  id = 'c'.repeat(24);
const account = (actorId: string) => ({
  userId: actorId,
  actorId,
  revision: 1,
  member: true,
  erased: false,
});
const fact = {
  kind: 'channel',
  channelId: id,
  policyKey: 'social.dm',
  policyRevision: 1,
  lifecycle: 'active',
  revision: 1,
  authority: {
    kind: 'dm',
    lowActorId: actor,
    highActorId: peer,
    requestSenderActorId: actor,
    state: 'accepted',
    blocked: false,
    revision: 2,
  },
} as const;
const accounts = [actor, peer].map((actorId) => ({
  account: account(actorId),
  age: {
    state: 'known',
    actorId,
    revision: 1,
    accountRevision: 1,
    band: 'adult',
    validUntil: '2026-11-01T00:00:00.000Z',
  } as const,
}));
const context: ObservationAuthorityContext = {
  principal: { kind: 'user', userId: actor, actorId: actor },
  account: account(actor),
  resource: { kind: 'channel', id },
  resourceFact: fact,
  socialAccounts: accounts,
  databaseNow: '2026-10-12T00:00:00.000Z',
};
const readingPolicy: ObservationReadingPolicy = ({
  channel,
  accounts,
  now,
}) => ({
  channelId: channel.channelId,
  policyKey: channel.policyKey,
  policyRevision: channel.policyRevision,
  authorityRevision: channel.revision,
  relationshipRevision:
    channel.authority.kind === 'dm'
      ? channel.authority.revision
      : channel.authority.generation,
  allowed: accounts.every((row) => row.account.member && !row.account.erased),
  evaluatedAt: now,
  validUntil: '2026-11-01T00:00:00.000Z',
  accounts: accounts.map((row) => ({
    actorId: row.account.actorId!,
    userId: row.account.userId,
    accountRevision: row.account.revision,
    ageRevision: row.age.state === 'known' ? row.age.revision : null,
  })),
});
test('the same full cast has identical peer evidence for either reader', () => {
  const decide = createObservationAuthorityDecision({ readingPolicy });
  const first = decide(context);
  const second = decide({
    ...context,
    principal: { kind: 'user', userId: peer, actorId: peer },
    account: account(peer),
  });
  const reordered = decide({
    ...context,
    socialAccounts: [...accounts].reverse(),
  });
  assert({
    given: 'either member independently reads an identical approved DM cohort',
    should:
      'return the same full policy dependencies without duplicating the individual subject',
    actual:
      first.status === 'allowed' &&
      second.status === 'allowed' &&
      JSON.stringify(first.dependencies) ===
        JSON.stringify(second.dependencies) &&
      reordered.status === 'allowed' &&
      JSON.stringify(first.dependencies) ===
        JSON.stringify(reordered.dependencies),
    expected: true,
  });
});
test('approved unknown-age reading follows canonical authority', () => {
  const decide = createObservationAuthorityDecision({ readingPolicy });
  const result = decide({
    ...context,
    socialAccounts: accounts.map((row) => ({
      ...row,
      age: { state: 'unknown' } as const,
    })),
  });
  assert({
    given:
      'canonical reading policy approves current accounts with unknown ages',
    should: 'allow observation without inventing a posting restriction',
    actual: result.status,
    expected: 'allowed',
  });
});
test('private group grant generations are independent evidence', () => {
  const decide = createObservationAuthorityDecision({ readingPolicy });
  const group = {
    ...fact,
    policyKey: 'social.private_group',
    authority: {
      kind: 'private_group',
      actorId: actor,
      role: 'member',
      generation: 1,
      activeMemberActorIds: [actor, peer],
    },
  } as const;
  const first = decide({ ...context, resourceFact: group });
  const second = decide({
    ...context,
    resourceFact: {
      ...group,
      authority: { ...group.authority, generation: 2 },
    },
  });
  assert({
    given:
      'a current group grant changes generation with unchanged channel/content identity',
    should: 'change evidence without partitioning identical bytes',
    actual: {
      statuses: [first.status, second.status],
      changed:
        first.status === 'allowed' &&
        second.status === 'allowed' &&
        JSON.stringify(first.dependencies) !==
          JSON.stringify(second.dependencies),
      sameBase:
        first.status === 'allowed' &&
        second.status === 'allowed' &&
        JSON.stringify(first.partition) === JSON.stringify(second.partition),
    },
    expected: {
      statuses: ['allowed', 'allowed'],
      changed: true,
      sameBase: true,
    },
  });
});
test('peer policy facts invalidate evidence without changing shared identity', () => {
  const decide = createObservationAuthorityDecision({ readingPolicy });
  const first = decide(context);
  const changed = decide({
    ...context,
    socialAccounts: accounts.map((row) =>
      row.account.actorId === peer
        ? { ...row, age: { ...row.age, band: '16-17' } }
        : row,
    ),
  });
  const denied = decide({
    ...context,
    socialAccounts: accounts.map((row) =>
      row.account.actorId === peer
        ? { ...row, account: { ...row.account, erased: true } }
        : row,
    ),
  });
  assert({
    given:
      'same durable age revisions but a changed peer temporal classification then peer erasure',
    should:
      'change complete evidence, preserve actor-independent projection partition and deny dependent reader',
    actual: {
      allow: first.status,
      changed: changed.status,
      partition:
        first.status === 'allowed' && changed.status === 'allowed'
          ? JSON.stringify(first.partition) ===
            JSON.stringify(changed.partition)
          : false,
      fingerprint:
        first.status === 'allowed' && changed.status === 'allowed'
          ? JSON.stringify(first.dependencies) !==
            JSON.stringify(changed.dependencies)
          : false,
      denied: denied.status,
    },
    expected: {
      allow: 'allowed',
      changed: 'allowed',
      partition: true,
      fingerprint: true,
      denied: 'denied',
    },
  });
});
test('missing policy and non-future producer boundary are unavailable', () => {
  const missing = createObservationAuthorityDecision({})(context);
  const expired = createObservationAuthorityDecision({
    readingPolicy: (input) => ({
      ...readingPolicy(input)!,
      validUntil: context.databaseNow,
    }),
  })(context);
  assert({
    given: 'missing canonical policy or an already elapsed boundary',
    should: 'refuse rather than invent a zero-duration renewal loop',
    actual: [missing.status, expired.status],
    expected: ['unavailable', 'denied'],
  });
});
