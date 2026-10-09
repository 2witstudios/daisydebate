import { assert, setupRitewayBun, test } from 'riteway/bun';
import { authorize, type ChannelAuthorizationFact } from './authorization';
import { input, resource } from './channel.test-support';
setupRitewayBun();
test('self-leave revokes only actual group membership without read or posting policy', () => {
  const group: ChannelAuthorizationFact = {
    ...resource,
    policyKey: 'social.private_group',
    lifecycle: 'archived',
    authority: {
      kind: 'private_group',
      actorId: 'a',
      role: 'member',
      generation: 2,
      activeMemberActorIds: ['a', 'b'],
    },
  };
  const context = { account: input.context.account };
  const evaluate = (row: ChannelAuthorizationFact) =>
    authorize({ ...input, capability: 'channel.leave', resource: row, context })
      .allow;
  assert({
    given:
      'own member/manager grants, revoked/foreign grants, DM and content capabilities',
    should:
      'allow only actual own group leave independently of admission/history',
    actual: [
      evaluate(group),
      evaluate({
        ...group,
        authority: {
          ...(group.authority as Extract<
            ChannelAuthorizationFact['authority'],
            { kind: 'private_group' }
          >),
          role: 'manager',
        },
      }),
      evaluate({
        ...group,
        authority: {
          kind: 'private_group',
          actorId: 'a',
          role: null,
          generation: 2,
          activeMemberActorIds: ['b'],
        },
      }),
      evaluate({
        ...group,
        authority: {
          kind: 'private_group',
          actorId: 'b',
          role: 'member',
          generation: 2,
          activeMemberActorIds: ['a', 'b'],
        },
      }),
      evaluate(resource),
      authorize({
        ...input,
        capability: 'channel.read',
        resource: group,
        context,
      }).allow,
      authorize({
        ...input,
        capability: 'channel.manage',
        resource: group,
        context,
      }).allow,
    ],
    expected: [true, true, false, false, false, false, false],
  });
});
