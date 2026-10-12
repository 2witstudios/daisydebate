import type {
  ObservationAuthorityContext,
  ObservationReadingPolicy,
} from './observation';

/** One accepted adult DM between two members, read by the first. */
export const actor = 'a'.repeat(24),
  peer = 'b'.repeat(24),
  id = 'c'.repeat(24);
export const account = (actorId: string) => ({
  userId: actorId,
  actorId,
  revision: 1,
  member: true,
  erased: false,
});
export const fact = {
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
export const accounts = [actor, peer].map((actorId) => ({
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
export const context: ObservationAuthorityContext = {
  principal: { kind: 'user', userId: actor, actorId: actor },
  account: account(actor),
  resource: { kind: 'channel', id },
  resourceFact: fact,
  socialAccounts: accounts,
  databaseNow: '2026-10-12T00:00:00.000Z',
};
export const readingPolicy: ObservationReadingPolicy = ({
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
