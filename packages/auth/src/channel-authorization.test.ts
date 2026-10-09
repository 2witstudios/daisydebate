import {
  resource,
  accounts,
  policy,
  input,
  pendingResource,
} from './channel.test-support';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  authorize,
  type AuthorizationInput,
  type ChannelAuthorizationFact,
} from './authorization';
setupRitewayBun();
const atActor = (actorId: string): AuthorizationInput => ({
  ...input,
  principal: { kind: 'user', userId: actorId === 'a' ? 'u' : 'v', actorId },
  context: {
    ...input.context,
    account: {
      ...input.context.account!,
      actorId,
      userId: actorId === 'a' ? 'u' : 'v',
    },
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
          authorize({
            ...input,
            context: socialReading
              ? { ...input.context, socialReading }
              : { account: input.context.account, socialPosting: policy },
          }).allow,
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
    const pending = pendingResource;
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

test('own-message removal is independent of posting admission', () => {
  const unknownAccounts = accounts.map((row) => ({
    ...row,
    age: { state: 'unknown' as const },
  }));
  const retainedReading = {
    ...policy,
    accounts: policy.accounts.map((row) => ({ ...row, ageRevision: null })),
  };
  const archived: ChannelAuthorizationFact = {
    ...resource,
    lifecycle: 'archived',
    authority: {
      ...resource.authority,
      kind: 'dm',
      lowActorId: 'a',
      highActorId: 'b',
      requestSenderActorId: 'a',
      state: 'accepted',
      revision: 3,
      blocked: true,
    },
  };
  const removal = {
    ...input,
    capability: 'channel.message.remove' as const,
    resource: archived,
    context: {
      ...input.context,
      socialAccounts: unknownAccounts,
      socialReading: retainedReading,
      socialPosting: { ...retainedReading, allowed: false },
    },
  };
  assert({
    given:
      'approved retained history on an archived blocked channel with unknown age',
    should:
      'permit only the distinct own-removal capability and retain read and entitlement holds',
    actual: [
      authorize(removal).allow,
      authorize({ ...removal, capability: 'channel.post' }).allow,
      authorize({
        ...removal,
        context: {
          ...removal.context,
          socialReading: { ...retainedReading, allowed: false },
        },
      }).allow,
      authorize({
        ...removal,
        resource: {
          ...archived,
          authority: {
            ...archived.authority,
            kind: 'dm',
            lowActorId: 'a',
            highActorId: 'b',
            requestSenderActorId: 'a',
            revision: 3,
            blocked: true,
            state: 'pending',
          },
        },
      }).allow,
    ],
    expected: [true, false, false, false],
  });
});
