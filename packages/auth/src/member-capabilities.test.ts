import { assert, setupRitewayBun, test } from 'riteway/bun';
import { authorize, type ChannelAuthorizationFact } from './authorization';
import { input, resource, accounts } from './channel.test-support';
import { socialPostingPolicy } from './social-policy';
import {
  messagingTestGroupPolicy,
  messagingTestGroupReading,
  messagingTestPosting,
  messagingTestReading,
} from './testing/social-policy';

setupRitewayBun();
test('Room collection creation and discovery require a current bound member', () => {
  const evaluate = (member: boolean) =>
    ['room.create', 'room.list'].map(
      (capability) =>
        authorize({
          ...input,
          capability: capability as 'room.create' | 'room.list',
          resource: { kind: 'room_collection' },
          context: { account: { ...input.context.account!, member } },
        }).allow,
    );
  assert({
    given: 'bound current membership or a provisional account',
    should:
      'allow explicit collection capabilities only for the current member',
    actual: [evaluate(true), evaluate(false)],
    expected: [
      [true, true],
      [false, false],
    ],
  });
});
test('group management requires a current manager grant and fresh posting authority', () => {
  const group: ChannelAuthorizationFact = {
    ...resource,
    policyKey: 'social.private_group',
    authority: {
      kind: 'private_group',
      actorId: 'a',
      role: 'manager',
      generation: 1,
      activeMemberActorIds: ['a', 'b'],
    },
  };
  const evaluate = (channel: ChannelAuthorizationFact) =>
    authorize({
      ...input,
      capability: 'channel.manage',
      resource: channel,
      context: {
        ...input.context,
        socialReading: (channel.authority.kind === 'dm'
          ? messagingTestReading
          : messagingTestGroupReading)({
          channel,
          accounts,
          now: input.context.now!,
        }),
        socialPosting: socialPostingPolicy({
          channel,
          accounts,
          now: input.context.now!,
          policy:
            channel.authority.kind === 'dm'
              ? messagingTestPosting
              : messagingTestGroupPolicy,
        }),
      },
    }).allow;
  const member: ChannelAuthorizationFact = {
    ...group,
    authority: {
      kind: 'private_group',
      actorId: 'a',
      role: 'member',
      generation: 1,
      activeMemberActorIds: ['a', 'b'],
    },
  };
  assert({
    given:
      'same current group facts for manager or ordinary member and a DM resource',
    should: 'grant management only to the persisted group manager',
    actual: [evaluate(group), evaluate(member), evaluate(resource)],
    expected: [true, false, false],
  });
});
