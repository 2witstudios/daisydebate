import type {
  AuthorizationInput,
  GroupInvitationAuthorizationFact,
} from './authorization';
import { adultAccount } from './social.test-support';
const now = '2026-10-09T00:00:00.000Z';
export const accounts = ['a', 'b', 'c'].map((actorId) => adultAccount(actorId));
export const invitation: GroupInvitationAuthorizationFact = {
  kind: 'group_invitation',
  channel: {
    channelId: 'group',
    kind: 'private_group',
    policyKey: 'social.private_group',
    policyRevision: 1,
    revision: 2,
    lifecycle: 'active',
    activeMemberActorIds: ['a', 'c'],
  },
  invitation: {
    channelId: 'group',
    inviterActorId: 'a',
    inviteeActorId: 'b',
    state: 'pending',
    generation: 3,
  },
  expectedGeneration: 3,
  inviterGrant: { actorId: 'a', role: 'manager', generation: 1 },
  contactPairs: [
    ['a', 'b'],
    ['a', 'c'],
    ['b', 'c'],
  ].map(([lowActorId, highActorId]) => ({
    lowActorId: lowActorId!,
    highActorId: highActorId!,
    blocked: false,
    revision: 1,
  })),
};
export const input: AuthorizationInput = {
  principal: { kind: 'user', userId: 'b', actorId: 'b' },
  capability: 'channel.invitation.accept',
  resource: invitation,
  context: {
    account: accounts[1]!.account,
    now,
    contactAccounts: accounts.slice(0, 2).map((row) => row.account),
    socialAccounts: accounts,
    socialCreationPolicy: {
      state: 'approved',
      decision: 'explicit isolated group fixture only',
      key: 'social.private_group',
      revision: 1,
      allowedBandPairs: [['adult', 'adult']],
      groupBlockScope: 'all_pairs',
    },
  },
};
export const asInviter = (
  capability: AuthorizationInput['capability'],
): AuthorizationInput => ({
  ...input,
  principal: { kind: 'user', userId: 'a', actorId: 'a' },
  capability,
  context: { ...input.context, account: accounts[0]!.account },
});
