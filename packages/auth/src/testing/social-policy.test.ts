import { assert, setupRitewayBun, test } from 'riteway/bun';
import { authorize } from '../authorization';
import { socialPostingPolicy } from '../social-policy';
import {
  accounts,
  input,
  pendingResource,
  resource,
} from '../channel.test-support';
import { messagingTestPosting, messagingTestReading } from './social-policy';
setupRitewayBun();
const now = input.context.now!;
test('shared social fixture declares only isolated adult DM posting', () => {
  assert({
    given: 'the explicit test-only posting fixture',
    should: 'approve only adult/adult social.dm revision1 for isolated tests',
    actual: messagingTestPosting,
    expected: {
      state: 'approved',
      decision: 'isolated browser fixture only',
      key: 'social.dm',
      revision: 1,
      allowedBandPairs: [['adult', 'adult']],
    },
  });
});
test('shared reading fixture refuses unavailable bindings and fresh-fact violations', () => {
  const cases = [
    { channel: resource, accounts, now },
    { channel: pendingResource, accounts, now },
    {
      channel: { ...resource, policyKey: 'social.private_group' },
      accounts,
      now,
    },
    { channel: { ...resource, policyRevision: 2 }, accounts, now },
    { channel: resource, accounts: accounts.slice(0, 1), now },
    { channel: resource, accounts: [accounts[0]!, accounts[0]!], now },
    ...[
      { member: false },
      { erased: true },
      { revision: 0 },
      { actorId: 'foreign' },
    ].map((patch) => ({
      channel: resource,
      accounts: [
        accounts[0]!,
        { ...accounts[1]!, account: { ...accounts[1]!.account, ...patch } },
      ],
      now,
    })),
    { channel: resource, accounts, now: 'invalid' },
    { channel: resource, accounts, now: '2026-11-01T00:00:00.000Z' },
    {
      channel: resource,
      accounts: [
        accounts[0]!,
        { ...accounts[1]!, age: { ...accounts[1]!.age, actorId: 'foreign' } },
      ],
      now,
    },
  ];
  assert({
    given:
      'current or missing, duplicate, erased, provisional, stale and unbound facts',
    should:
      'mint fixture reading evidence only for the exact current DM accounts',
    actual: cases.map((row) => messagingTestReading(row).allowed),
    expected: [true, true, ...Array.from({ length: 11 }, () => false)],
  });
});
test('shared fixture evidence still requires the sole canonical consumer', () => {
  const socialReading = messagingTestReading({
    channel: pendingResource,
    accounts,
    now,
  });
  const context = { ...input.context, socialReading };
  const recipient = { kind: 'user' as const, userId: 'v', actorId: 'b' };
  const allowed = [
    authorize({
      ...input,
      resource: pendingResource,
      capability: 'channel.request.read',
      context,
    }).allow,
    authorize({
      ...input,
      principal: recipient,
      resource: pendingResource,
      capability: 'channel.request.read',
      context: { ...context, account: accounts[1]!.account },
    }).allow,
    authorize({ ...input, resource: pendingResource, context }).allow,
    authorize({
      ...input,
      resource: pendingResource,
      capability: 'channel.post',
      context,
    }).allow,
    authorize({
      ...input,
      resource: pendingResource,
      capability: 'channel.request.status',
      context: { ...context, now: '2026-11-01T00:00:00.000Z' },
    }).allow,
  ];
  assert({
    given: 'shared explicit reading proof for a pending request',
    should:
      'preserve sender introduction and ordinary content refusal, recipient entitlement and expiry',
    actual: allowed,
    expected: [false, true, false, false, false],
  });
  const unknown = accounts.map((row) => ({
    ...row,
    age: { state: 'unknown' as const },
  }));
  assert({
    given: 'unknown age with explicitly isolated retained reading',
    should: 'allow the reading fixture while keeping posting unavailable',
    actual: [
      messagingTestReading({ channel: resource, accounts: unknown, now })
        .allowed,
      socialPostingPolicy({
        channel: resource,
        accounts: unknown,
        now,
        policy: messagingTestPosting,
      }).allowed,
    ],
    expected: [true, false],
  });
});
