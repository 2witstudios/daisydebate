import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  authorize,
  type AuthorizationInput,
  type ChannelAuthorizationFact,
} from './authorization';
setupRitewayBun();
const resource: ChannelAuthorizationFact = {
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
const policy = {
  channelId: 'c',
  policyKey: 'social.dm',
  policyRevision: 1,
  authorityRevision: 2,
  relationshipRevision: 3,
  allowed: true,
};
const input: AuthorizationInput = {
  principal: { kind: 'user', userId: 'u', actorId: 'a' },
  capability: 'channel.read',
  resource,
  context: {
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
const atActor = (actorId: string): AuthorizationInput => ({
  ...input,
  principal: { kind: 'user', userId: 'u', actorId },
  context: {
    ...input.context,
    account: { ...input.context.account!, actorId },
  },
});
describe('canonical channel decisions', () => {
  test('fresh policy proof must match current authority', () => {
    assert({
      given:
        'missing, stale relationship, stale channel and valid policy facts',
      should: 'allow only current approved reading',
      actual: [
        undefined,
        { ...policy, relationshipRevision: 2 },
        { ...policy, authorityRevision: 1 },
        policy,
      ].map(
        (socialReading) =>
          authorize({ ...input, context: socialReading ? { ...input.context, socialReading } : { account: input.context.account, socialPosting: policy } })
            .allow,
      ),
      expected: [false, false, false, true],
    });
  });
  test('block policy distinguishes read and new posting', () => {
    const blocked: ChannelAuthorizationFact = {
      ...resource,
      authority: {
        ...resource.authority,
        kind: 'dm',
        lowActorId: 'a',
        highActorId: 'b',
        requestSenderActorId: 'a',
        state: 'accepted',
        blocked: true,
        revision: 3,
      },
    };
    assert({
      given: 'a blocked accepted pair with explicit retained history policy',
      should: 'allow read and refuse new sends',
      actual: ['channel.read', 'channel.post'].map(
        (capability) =>
          authorize({
            ...input,
            capability: capability as AuthorizationInput['capability'],
            resource: blocked,
          }).allow,
      ),
      expected: [true, false],
    });
  });
  test('pending request is not ordinary channel access', () => {
    const pending: ChannelAuthorizationFact = {
      ...resource,
      authority: {
        kind: 'dm',
        lowActorId: 'a',
        highActorId: 'b',
        requestSenderActorId: 'a',
        state: 'pending',
        blocked: false,
        revision: 3,
      },
    };
    assert({
      given: 'a pending addressed request',
      should: 'allow recipient read/decide and sender cancel only',
      actual: ['a', 'b', 'foreign'].flatMap((actor) =>
        [
          'channel.read',
          'channel.post',
          'channel.request.read',
          'channel.request.decide',
          'channel.request.cancel',
        ].map(
          (capability) =>
            authorize({
              ...atActor(actor),
              resource: pending,
              capability: capability as AuthorizationInput['capability'],
            }).allow,
        ),
      ),
      expected: [
        false,
        false,
        false,
        false,
        true,
        false,
        false,
        true,
        true,
        false,
        false,
        false,
        false,
        false,
        false,
      ],
    });
  });
  test('malformed policy kind and revisions fail closed', () => {
    assert({
      given: 'foreign kind policy, invalid revisions and unknown capability',
      should: 'refuse rather than fall through to posting',
      actual: [
        authorize({
          ...input,
          resource: { ...resource, policyKey: 'social.private_group' },
        }).allow,
        authorize({ ...input, resource: { ...resource, revision: 0 } }).allow,
        authorize({
          ...input,
          capability: 'channel.unknown' as AuthorizationInput['capability'],
        }).allow,
      ],
      expected: [false, false, false],
    });
  });
});
