import type {
  AuthorizationInput,
  ChannelAuthorizationFact,
} from './authorization';
export const actorId = 'a'.repeat(24);
export const peerId = 'b'.repeat(24);
export const channel: ChannelAuthorizationFact = {
  kind: 'channel',
  channelId: 'c'.repeat(24),
  policyKey: 'social.private_group',
  policyRevision: 1,
  revision: 2,
  lifecycle: 'active',
  authority: {
    kind: 'private_group',
    actorId,
    role: 'manager',
    generation: 3,
    activeMemberActorIds: [actorId, peerId],
  },
};
export const input: AuthorizationInput = {
  principal: { kind: 'user', userId: actorId, actorId },
  capability: 'channel.group.revoke',
  resource: channel,
  context: {
    account: {
      userId: actorId,
      actorId,
      member: true,
      erased: false,
      revision: 4,
    },
  },
};
