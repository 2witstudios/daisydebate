import { assert, setupRitewayBun, test } from 'riteway/bun';
import { authorize } from './authorization';
import { adultAccount } from './social.test-support';
setupRitewayBun();
const accounts = ['a', 'b'].map((id) => adultAccount(id));
const now = '2026-10-09T00:00:00.000Z';
const resource = {
  kind: 'social_creation' as const,
  mode: 'dm' as const,
  initiatorActorId: 'a',
  recipientActorId: 'b',
  policyKey: 'social.dm' as const,
  policyRevision: 1,
  contactPair: {
    lowActorId: 'a',
    highActorId: 'b',
    blocked: false,
    revision: 1,
  },
};
const policy = {
  state: 'approved' as const,
  decision: 'test-only prospective policy; no activation',
  key: 'social.dm',
  revision: 1,
  allowedBandPairs: [['adult', 'adult'] as const],
};
test('prospective requests consume facts without fabricating channel membership', () => {
  const input = {
    principal: { kind: 'user' as const, userId: 'a', actorId: 'a' },
    capability: 'social.request.create' as const,
    resource,
    context: {
      account: accounts[0]!.account,
      now,
      socialAccounts: accounts,
      socialCreationPolicy: policy,
    },
  };
  assert({
    given:
      'current proposed accounts and a canonical pair fence, without a channel',
    should:
      'allow explicit fresh policy and refuse missing policy, block or foreign initiator',
    actual: [
      authorize(input).allow,
      authorize({
        ...input,
        context: {
          ...input.context,
          socialCreationPolicy: { state: 'pending' },
        },
      }).allow,
      authorize({
        ...input,
        resource: {
          ...resource,
          contactPair: { ...resource.contactPair, blocked: true },
        },
      }).allow,
      authorize({ ...input, resource: { ...resource, initiatorActorId: 'b' } })
        .allow,
    ],
    expected: [true, false, false, false],
  });
});

test('group creation requires explicit block scope and complete current accounts', () => {
  const current = [...accounts, adultAccount('c')];
  const group = {
    kind: 'social_creation' as const,
    mode: 'private_group' as const,
    initiatorActorId: 'a',
    memberActorIds: ['a', 'b', 'c'],
    policyKey: 'social.private_group' as const,
    policyRevision: 1,
    contactPairs: [
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'c'],
    ].map(([lowActorId, highActorId]) => ({
      lowActorId: lowActorId!,
      highActorId: highActorId!,
      blocked: lowActorId === 'b',
      revision: 1,
    })),
  };
  const groupPolicy = { ...policy, key: 'social.private_group' };
  const evaluate = (
    resource: typeof group,
    inputPolicy: typeof groupPolicy & {
      groupBlockScope?: 'all_pairs' | 'initiator';
    },
    rows = current,
  ) =>
    authorize({
      principal: { kind: 'user', userId: 'a', actorId: 'a' },
      capability: 'channel.create.private_group',
      resource,
      context: {
        account: current[0]!.account,
        now,
        socialAccounts: rows,
        socialCreationPolicy: inputPolicy,
      },
    }).allow;
  assert({
    given:
      'a blocked noninitiator pair, missing scope/pair, stale peer and wrong policy key',
    should:
      'apply only explicit block scope and refuse incomplete or stale facts',
    actual: [
      evaluate(group, groupPolicy),
      evaluate(group, { ...groupPolicy, groupBlockScope: 'all_pairs' }),
      evaluate(group, { ...groupPolicy, groupBlockScope: 'initiator' }),
      evaluate(
        { ...group, contactPairs: group.contactPairs.slice(0, 1) },
        { ...groupPolicy, groupBlockScope: 'initiator' },
      ),
      evaluate(group, {
        ...groupPolicy,
        key: 'social.dm',
        groupBlockScope: 'initiator',
      }),
      evaluate(
        group,
        { ...groupPolicy, groupBlockScope: 'initiator' },
        current.map((row, index) =>
          index === 2
            ? {
                ...row,
                age: { ...row.age, validUntil: '2026-10-01T00:00:00.000Z' },
              }
            : row,
        ),
      ),
    ],
    expected: [false, false, true, false, false, false],
  });
});
