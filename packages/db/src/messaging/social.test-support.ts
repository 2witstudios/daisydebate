import { parseMessagingChannelFact } from './social';
export function messagingAuthorityFixture() {
  const actors = ['a', 'b'].map((letter) => letter.repeat(24));
  return parseMessagingChannelFact({
    ...Object.fromEntries([
      ['kind', 'channel'],
      ['channelId', 'c'.repeat(24)],
      ['policyKey', 'social.dm'],
      ['policyRevision', 1],
      ['lifecycle', 'active'],
      ['revision', 1],
    ]),
    authority: Object.fromEntries([
      ['kind', 'dm'],
      ['lowActorId', actors[0]],
      ['highActorId', actors[1]],
      ['requestSenderActorId', actors[0]],
      ['state', 'pending'],
      ['blocked', false],
      ['revision', 1],
    ]),
  });
}
