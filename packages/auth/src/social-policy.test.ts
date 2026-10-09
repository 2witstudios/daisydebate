import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { authorize } from './authorization';
import { socialPostingPolicy } from './social-policy';
import type { ChannelAuthorizationFact } from './authorization';
setupRitewayBun();
const channel: ChannelAuthorizationFact = {
  kind: 'channel',
  channelId: 'c',
  policyKey: 'social.private_group',
  policyRevision: 1,
  lifecycle: 'active',
  revision: 2,
  authority: {
    kind: 'private_group',
    actorId: 'a',
    role: 'member',
    generation: 1,
    activeMemberActorIds: ['a', 'b'],
  },
};
const accounts = ['a', 'b'].map((actorId) => ({
  account: {
    userId: actorId,
    actorId,
    member: true,
    erased: false,
    revision: 1,
  },
  age: {
    state: 'known' as const,
    actorId,
    band: 'adult' as const,
    revision: 1,
    accountRevision: 1,
    validUntil: '2026-11-01T00:00:00.000Z',
  },
}));
const policy = {
  state: 'approved' as const,
  decision: 'test-only explicit policy',
  key: 'social.private_group',
  revision: 1,
  allowedBandPairs: [['adult', 'adult'] as const],
};
describe('current social policy projection', () => {
  test('policy holds and missing current members never authorize', () =>
    assert({
      given: 'held policy, missing peer and all current adult facts',
      should:
        'refuse unavailable authority and allow only explicit complete policy',
      actual: [
        socialPostingPolicy({
          channel,
          accounts,
          now: '2026-10-09T00:00:00.000Z',
          policy: { state: 'pending' },
        }).allowed,
        socialPostingPolicy({
          channel,
          accounts: accounts.slice(0, 1),
          now: '2026-10-09T00:00:00.000Z',
          policy,
        }).allowed,
        socialPostingPolicy({
          channel,
          accounts,
          now: '2026-10-09T00:00:00.000Z',
          policy,
        }).allowed,
      ],
      expected: [false, false, true],
    }));
  test('age expiry and account correction invalidate old facts', () =>
    assert({
      given: 'UTC month expiry and corrected account revision',
      should: 'refuse stale facts',
      actual: [
        socialPostingPolicy({
          channel,
          accounts,
          now: '2026-11-01T00:00:00.000Z',
          policy,
        }).allowed,
        socialPostingPolicy({
          channel,
          accounts: accounts.map((row) => ({
            ...row,
            account: { ...row.account, revision: 2 },
          })),
          now: '2026-10-09T00:00:00.000Z',
          policy,
        }).allowed,
      ],
      expected: [false, false],
    }));
});

test('a prior allowance cannot survive account correction or expiry', () => {
  const now = '2026-10-09T00:00:00.000Z';
  const proof = socialPostingPolicy({ channel, accounts, now, policy });
  const changed = accounts.map((row) => ({
    ...row,
    account: { ...row.account, revision: 2 },
    age: {
      ...row.age,
      band: 'under-13' as const,
      revision: 2,
      accountRevision: 2,
    },
  }));
  const evaluate = (
    current: Parameters<typeof socialPostingPolicy>[0]['accounts'],
    time: string,
  ) =>
    authorize({
      principal: { kind: 'user', userId: 'a', actorId: 'a' },
      capability: 'channel.post',
      resource: channel,
      context: {
        account: current[0]!.account,
        now: time,
        socialAccounts: current,
        socialReading: proof,
        socialPosting: proof,
      },
    }).allow;
  assert({
    given:
      'previously allowed adult evidence replayed after correction and month expiry',
    should: 'deny both stale authorizations and preserve a fresh allowance',
    actual: [
      evaluate(accounts, now),
      evaluate(changed, now),
      evaluate(accounts, '2026-11-01T00:00:00.000Z'),
    ],
    expected: [true, false, false],
  });
});
