import { assert, setupRitewayBun, test } from 'riteway/bun';
import { authorize, type AuthorizationInput } from './authorization';
setupRitewayBun();
const actorId = 'a'.repeat(24);
const channelId = 'b'.repeat(24);
const resource = {
  kind: 'group_command_result' as const,
  channel: {
    channelId,
    kind: 'private_group' as const,
    policyKey: 'social.private_group' as const,
    policyRevision: 1,
    revision: 2,
    lifecycle: 'archived' as const,
  },
  command: {
    actorId,
    requestId: 'c'.repeat(24),
    kind: 'group.leave' as const,
    resultChannelId: channelId,
  },
};
const input = {
  principal: { kind: 'user' as const, userId: actorId, actorId },
  capability: 'channel.group.result' as AuthorizationInput['capability'],
  resource,
  context: {
    account: {
      userId: actorId,
      actorId,
      member: true,
      erased: false,
      revision: 3,
    },
  },
};
test('closed own group commands retain minimal results after authority revocation', () => {
  assert({
    given:
      'committed own commands, archived channel and no grant, age or content policy',
    should:
      'permit only minimal results for the closed group mutation vocabulary',
    actual: [
      'group.invite',
      'group.remove',
      'group.leave',
      'group.transfer',
      'group.archive',
    ].map(
      (kind) =>
        authorize({
          ...input,
          resource: { ...resource, command: { ...resource.command, kind } },
        }).allow,
    ),
    expected: [true, true, true, true, true],
  });
});
test('group result refuses foreign, malformed, erased and isolated authority', () => {
  const cases = [
    {
      ...input,
      resource: {
        ...resource,
        command: { ...resource.command, actorId: 'd'.repeat(24) },
      },
    },
    {
      ...input,
      resource: {
        ...resource,
        command: { ...resource.command, resultChannelId: 'd'.repeat(24) },
      },
    },
    {
      ...input,
      resource: {
        ...resource,
        command: { ...resource.command, requestId: '' },
      },
    },
    {
      ...input,
      resource: {
        ...resource,
        command: { ...resource.command, kind: 'group.create' },
      },
    },
    {
      ...input,
      resource: { ...resource, channel: { ...resource.channel, revision: 0 } },
    },
    {
      ...input,
      resource: {
        ...resource,
        channel: { ...resource.channel, policyRevision: 0 },
      },
    },
    {
      ...input,
      resource: {
        ...resource,
        channel: {
          ...resource.channel,
          policyKey: 'social.dm' as 'social.private_group',
        },
      },
    },
    {
      ...input,
      context: { account: { ...input.context.account, erased: true } },
    },
    {
      ...input,
      context: { account: { ...input.context.account, member: false } },
    },
    {
      ...input,
      context: { account: { ...input.context.account, revision: 0 } },
    },
    { ...input, principal: { kind: 'anonymous' as const } },
    { ...input, principal: { ...input.principal, userId: 'foreign' } },
    ...(
      [
        'channel.read',
        'channel.manage',
        'channel.leave',
        'channel.post',
        'channel.subscribe',
        'channel.invitation.result',
      ] as const
    ).map((capability) => ({ ...input, capability })),
  ];
  assert({
    given:
      'foreign associations, invalid facts/accounts and content or mutation capabilities',
    should: 'refuse without recreating a membership or admitting a mutation',
    actual: cases.map((candidate) => authorize(candidate).allow),
    expected: cases.map(() => false),
  });
});
