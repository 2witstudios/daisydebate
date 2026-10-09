import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  authorize,
  type GroupInvitationAuthorizationFact,
} from './authorization';
import { input, invitation } from './group-invitation.test-support';
setupRitewayBun();
test('invitation facts require exact current generation and durable authority shape', () => {
  const cases: GroupInvitationAuthorizationFact[] = [
    { ...invitation, channel: { ...invitation.channel, revision: 0 } },
    { ...invitation, channel: { ...invitation.channel, policyRevision: 0 } },
    {
      ...invitation,
      channel: { ...invitation.channel, activeMemberActorIds: ['a', 'a'] },
    },
    {
      ...invitation,
      inviterGrant: { ...invitation.inviterGrant, generation: 0 },
    },
    {
      ...invitation,
      inviterGrant: { ...invitation.inviterGrant, actorId: 'c' },
    },
    { ...invitation, invitation: { ...invitation.invitation, generation: 0 } },
    {
      ...invitation,
      invitation: { ...invitation.invitation, inviteeActorId: 'a' },
    },
    {
      ...invitation,
      contactPairs: [...invitation.contactPairs, invitation.contactPairs[0]!],
    },
    {
      ...invitation,
      contactPairs: invitation.contactPairs.map((pair) => ({
        ...pair,
        revision: 0,
      })),
    },
    { ...invitation, expectedGeneration: 0 },
  ];
  assert({
    given: 'malformed or inconsistent current invitation facts',
    should: 'deny rather than mint authority',
    actual: cases.map((resource) => authorize({ ...input, resource }).allow),
    expected: cases.map(() => false),
  });
  const withoutExpected = { ...invitation };
  delete withoutExpected.expectedGeneration;
  assert({
    given: 'absent expected generation',
    should: 'allow minimal pending read but refuse state mutation/replay',
    actual: [
      'channel.invitation.read',
      'channel.invitation.accept',
      'channel.invitation.decline',
      'channel.invitation.result',
    ].map(
      (capability) =>
        authorize({
          ...input,
          capability: capability as typeof input.capability,
          resource: withoutExpected,
        }).allow,
    ),
    expected: [true, false, false, false],
  });
});
test('group invitation acceptance preserves explicit block scope and policy revision', () => {
  const policy = {
    state: 'approved' as const,
    decision: 'isolated explicit fixture only',
    key: 'social.private_group',
    revision: 1,
    allowedBandPairs: [['adult', 'adult']] as const,
  };
  const blocked = {
    ...invitation,
    contactPairs: invitation.contactPairs.map((pair) => ({
      ...pair,
      blocked: pair.lowActorId === 'b' && pair.highActorId === 'c',
    })),
  };
  assert({
    given:
      'a blocked noninitiator pair and explicit alternative group policies',
    should: 'apply only the selected scope and deny missing/mismatched policy',
    actual: [
      authorize({
        ...input,
        resource: blocked,
        context: {
          ...input.context,
          socialCreationPolicy: { ...policy, groupBlockScope: 'all_pairs' },
        },
      }).allow,
      authorize({
        ...input,
        resource: blocked,
        context: {
          ...input.context,
          socialCreationPolicy: { ...policy, groupBlockScope: 'initiator' },
        },
      }).allow,
      authorize({
        ...input,
        context: { ...input.context, socialCreationPolicy: policy },
      }).allow,
      authorize({
        ...input,
        context: {
          ...input.context,
          socialCreationPolicy: {
            ...policy,
            revision: 2,
            groupBlockScope: 'all_pairs',
          },
        },
      }).allow,
    ],
    expected: [false, true, false, false],
  });
});
