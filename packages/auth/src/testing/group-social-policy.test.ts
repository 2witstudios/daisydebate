import { assert, setupRitewayBun, test } from 'riteway/bun';
import { authorize, type ChannelAuthorizationFact } from '../authorization';
import { socialPostingPolicy } from '../social-policy';
import { accounts, input, resource } from '../channel.test-support';
import {
  messagingTestGroupPolicy,
  messagingTestGroupReading,
  messagingTestReading,
} from './social-policy';

setupRitewayBun();
const channel: ChannelAuthorizationFact = {
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
const now = input.context.now!;
test('group browser fixture is explicit isolated adult policy without changing DM fixtures', () => {
  assert({
    given: 'the named group fixture',
    should:
      'select isolated revision1 adult admission and all-pairs blocks without production authority',
    actual: messagingTestGroupPolicy,
    expected: {
      state: 'approved',
      decision: 'isolated browser fixture only',
      key: 'social.private_group',
      revision: 1,
      allowedBandPairs: [['adult', 'adult']],
      groupBlockScope: 'all_pairs',
    },
  });
  assert({
    given: 'DM/group channels and explicit group posting',
    should: 'keep each fixture scoped to its matching policy kind',
    actual: [
      messagingTestGroupReading({ channel, accounts, now }).allowed,
      messagingTestReading({ channel, accounts, now }).allowed,
      messagingTestGroupReading({ channel: resource, accounts, now }).allowed,
      socialPostingPolicy({
        channel,
        accounts,
        now,
        policy: messagingTestGroupPolicy,
      }).allowed,
    ],
    expected: [true, false, false, true],
  });
});
test('group fixture keeps fresh membership, exact account set and canonical grant requirements', () => {
  const evaluate = (rows: typeof accounts, instant = now) =>
    messagingTestGroupReading({ channel, accounts: rows, now: instant })
      .allowed;
  const unknown = accounts.map((row) => ({
    ...row,
    age: { state: 'unknown' as const },
  }));
  const reading = messagingTestGroupReading({ channel, accounts, now });
  assert({
    given:
      'missing duplicate erased provisional stale and unknown-age accounts',
    should:
      'fail invalid reading facts while keeping unknown-age posting unavailable',
    actual: [
      evaluate(accounts.slice(0, 1)),
      evaluate([accounts[0]!, accounts[0]!]),
      evaluate(
        accounts.map((row) => ({
          ...row,
          account: { ...row.account, erased: true },
        })),
      ),
      evaluate(
        accounts.map((row) => ({
          ...row,
          account: { ...row.account, member: false },
        })),
      ),
      evaluate(accounts, '2026-11-01T00:00:00.000Z'),
      evaluate(unknown),
      socialPostingPolicy({
        channel,
        accounts: unknown,
        now,
        policy: messagingTestGroupPolicy,
      }).allowed,
    ],
    expected: [false, false, false, false, false, true, false],
  });
  const noGrant: ChannelAuthorizationFact = {
    ...channel,
    authority: {
      kind: 'private_group',
      actorId: 'a',
      role: null,
      generation: 0,
      activeMemberActorIds: ['a', 'b'],
    },
  };
  assert({
    given: 'explicit test evidence but no persisted caller grant',
    should: 'keep ordinary content denied by canonical authorization',
    actual: authorize({
      ...input,
      resource: noGrant,
      context: { ...input.context, socialReading: reading },
    }).allow,
    expected: false,
  });
});
