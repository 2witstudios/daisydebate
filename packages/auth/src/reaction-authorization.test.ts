import { test } from 'bun:test';
import { assert, setupRitewayBun } from 'riteway/bun';
import { authorize, type AuthorizationInput } from './authorization';
import { input, resource, policy } from './channel.test-support';
setupRitewayBun();
const removal: AuthorizationInput = {
  ...input,
  capability: 'channel.reaction.remove',
  resource: {
    kind: 'channel_reaction',
    channel: { ...resource, lifecycle: 'archived' },
    reaction: {
      actorId: 'a',
      channelId: 'c',
      messageId: 'm'.repeat(24),
      reaction: 'chosen',
    },
  },
  context: { ...input.context, socialPosting: { ...policy, allowed: false } },
};
test('reaction removal consumes only own live association and fresh reading', () => {
  if (removal.resource.kind !== 'channel_reaction')
    throw new Error('Wrong fixture');
  const fact = removal.resource;
  const cases: AuthorizationInput[] = [
    removal,
    {
      ...removal,
      resource: { ...fact, reaction: { ...fact.reaction, actorId: 'b' } },
    },
    {
      ...removal,
      resource: {
        ...fact,
        reaction: { ...fact.reaction, channelId: 'foreign' },
      },
    },
    {
      ...removal,
      resource: { ...fact, reaction: { ...fact.reaction, messageId: '' } },
    },
    {
      ...removal,
      resource: { ...fact, reaction: { ...fact.reaction, reaction: '' } },
    },
    {
      ...removal,
      context: {
        ...removal.context,
        socialReading: { ...policy, allowed: false },
      },
    },
    { ...removal, context: { ...removal.context, now: policy.validUntil } },
    {
      ...removal,
      context: {
        ...removal.context,
        account: { ...input.context.account!, erased: true },
      },
    },
    ...(
      ['channel.read', 'channel.post', 'channel.message.remove'] as const
    ).map((capability) => ({ ...removal, capability })),
    { ...removal, resource },
  ];
  assert({
    given:
      'an archived channel, denied posting and an actual locked own reaction',
    should:
      'permit removal only with current reading and exact own association, without other grants',
    actual: cases.map((row) => authorize(row).allow),
    expected: [true, ...Array(11).fill(false)],
  });
});
