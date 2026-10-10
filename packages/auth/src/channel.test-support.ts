import { adultAccount } from './social.test-support';
import type {
  AuthorizationInput,
  ChannelAuthorizationFact,
} from './authorization';
export const resource: ChannelAuthorizationFact = {
  kind: 'channel',
  channelId: 'c',
  policyKey: 'social.dm',
  policyRevision: 1,
  lifecycle: 'active',
  revision: 2,
  authority: {
    kind: 'dm',
    lowActorId: 'a',
    highActorId: 'b',
    requestSenderActorId: 'a',
    state: 'accepted',
    blocked: false,
    revision: 3,
  },
};
export const accounts = ['a', 'b'].map((actorId) =>
  adultAccount(actorId, actorId === 'a' ? 'u' : 'v'),
);
export const policy = {
  evaluatedAt: '2026-10-09T00:00:00.000Z',
  validUntil: '2026-11-01T00:00:00.000Z',
  accounts: accounts.map((row) => ({
    actorId: row.account.actorId,
    userId: row.account.userId,
    accountRevision: 1,
    ageRevision: 1,
  })),
  channelId: 'c',
  policyKey: 'social.dm',
  policyRevision: 1,
  authorityRevision: 2,
  relationshipRevision: 3,
  allowed: true,
};
export const input: AuthorizationInput = {
  principal: { kind: 'user', userId: 'u', actorId: 'a' },
  capability: 'channel.read',
  resource,
  context: {
    now: '2026-10-09T00:00:00.000Z',
    socialAccounts: accounts,
    account: {
      userId: 'u',
      actorId: 'a',
      member: true,
      erased: false,
      revision: 1,
    },
    socialReading: policy,
    socialPosting: policy,
  },
};

export const pendingResource: ChannelAuthorizationFact = {
  ...resource,
  authority: {
    ...(resource.authority as Extract<
      ChannelAuthorizationFact['authority'],
      { kind: 'dm' }
    >),
    state: 'pending',
  },
};
