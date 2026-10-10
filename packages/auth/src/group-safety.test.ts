import { assert, setupRitewayBun, test } from 'riteway/bun';
import { adultAccount } from './social.test-support';
import {
  authorize,
  type AuthorizationInput,
  type ChannelAuthorizationFact,
} from './authorization';
setupRitewayBun();
import { actorId, peerId, channel, input } from './group.test-support';
const group = channel.authority;
if (group.kind !== 'private_group')
  throw new Error('Expected private group fixture');
test('manager safety revoke and archive survive unavailable age and posting admission', () => {
  const candidates: AuthorizationInput[] = [
    input,
    { ...input, capability: 'channel.group.archive' },
    { ...input, resource: { ...channel, lifecycle: 'archived' } },
    {
      ...input,
      capability: 'channel.group.archive',
      resource: { ...channel, lifecycle: 'archived' },
    },
    { ...input, capability: 'channel.manage' },
    { ...input, capability: 'channel.post' },
    { ...input, capability: 'channel.read' },
    { ...input, capability: 'channel.leave' },
  ];
  assert({
    given:
      'current manager with no age, reading or posting policy and active/archived core',
    should:
      'grant only safety revocation, first archive and existing self leave',
    actual: candidates.map((candidate) => authorize(candidate).allow),
    expected: [true, true, true, false, false, false, false, true],
  });
});
test('unsafe age facts neither strand safety nor broaden ordinary management', () => {
  const self = adultAccount(actorId);
  const peer = adultAccount(peerId);
  const contexts: AuthorizationInput['context'][] = [
    {
      ...input.context,
      socialAccounts: [{ ...self, age: { state: 'unknown' } }, peer],
    },
    {
      ...input.context,
      socialAccounts: [self, { ...peer, age: { ...peer.age, band: '13-15' } }],
    },
  ];
  assert({
    given: 'current manager with unknown self age or mixed-band existing cast',
    should:
      'allow explicit safety while refusing management, posting and reads without policy',
    actual: contexts.flatMap((context) =>
      (
        [
          'channel.group.revoke',
          'channel.group.archive',
          'channel.manage',
          'channel.post',
          'channel.read',
        ] as const
      ).map((capability) => authorize({ ...input, context, capability }).allow),
    ),
    expected: [
      true,
      true,
      false,
      false,
      false,
      true,
      true,
      false,
      false,
      false,
    ],
  });
});
test('manager safety requires current own positive-generation manager and bound account', () => {
  const resources: ChannelAuthorizationFact[] = [
    { ...channel, authority: { ...group, role: 'member' } },
    { ...channel, authority: { ...group, role: null } },
    { ...channel, authority: { ...group, actorId: peerId } },
    { ...channel, authority: { ...group, generation: 0 } },
    { ...channel, authority: { ...group, generation: 1.5 } },
    { ...channel, authority: { ...group, activeMemberActorIds: [peerId] } },
    {
      ...channel,
      authority: { ...group, activeMemberActorIds: [actorId, actorId] },
    },
    {
      ...channel,
      authority: { ...group, activeMemberActorIds: [actorId, 'invalid'] },
    },
    { ...channel, policyKey: 'social.dm' },
    { ...channel, policyRevision: 0 },
    { ...channel, revision: Number.NaN },
    { ...channel, channelId: '' },
    {
      ...channel,
      authority: {
        kind: 'dm',
        lowActorId: actorId,
        highActorId: peerId,
        requestSenderActorId: actorId,
        state: 'accepted',
        blocked: false,
        revision: 1,
      },
      policyKey: 'social.dm',
    },
  ];
  const candidates: AuthorizationInput[] = resources.map((resource) => ({
    ...input,
    resource,
  }));
  for (const account of [
    null,
    { ...input.context.account!, erased: true },
    { ...input.context.account!, member: false },
    { ...input.context.account!, revision: 0 },
    { ...input.context.account!, actorId: peerId },
    { ...input.context.account!, userId: peerId },
  ])
    candidates.push({ ...input, context: { account } });
  candidates.push({ ...input, principal: { kind: 'anonymous' } });
  assert({
    given:
      'foreign/revoked grants, invalid core/cast/revisions, DM or erased/unbound accounts',
    should:
      'deny both manager safety capabilities without a grant or eligibility fallback',
    actual: candidates.flatMap((candidate) => [
      authorize(candidate).allow,
      authorize({ ...candidate, capability: 'channel.group.archive' }).allow,
    ]),
    expected: candidates.flatMap(() => [false, false]),
  });
});
