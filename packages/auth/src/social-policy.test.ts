import { adultAccount } from './social.test-support';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { authorize } from './authorization';
import { betaDmPolicy, socialPostingPolicy } from './social-policy';
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
const accounts = ['a', 'b'].map((actorId) => adultAccount(actorId));
const policy = {
  state: 'approved' as const,
  decision: 'test-only explicit policy',
  key: 'social.private_group',
  revision: 1,
  earlierRevisions: [],
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

test('current peer age binding invalidates a prior allowance', () => {
  const now = '2026-10-09T00:00:00.000Z';
  const proof = socialPostingPolicy({ channel, accounts, now, policy });
  const invalidAges = [
    { validUntil: '2026-10-01T00:00:00.000Z' },
    { actorId: 'foreign' },
    { accountRevision: 2 },
  ];
  const results = invalidAges.map((patch) => {
    const current = accounts.map((row, index) =>
      index === 1 ? { ...row, age: { ...row.age, ...patch } } : row,
    );
    return [
      socialPostingPolicy({ channel, accounts: current, now, policy }).allowed,
      authorize({
        principal: { kind: 'user', userId: 'a', actorId: 'a' },
        capability: 'channel.post',
        resource: channel,
        context: {
          account: current[0]!.account,
          now,
          socialAccounts: current,
          socialReading: proof,
          socialPosting: proof,
        },
      }).allow,
    ];
  });
  assert({
    given: 'an expired, foreign or account-mismatched current peer age',
    should: 'deny both fresh projection and replay of earlier allowed evidence',
    actual: results,
    expected: [
      [false, false],
      [false, false],
      [false, false],
    ],
  });
});

describe('DM posting under decision 90 (ADR 0160)', () => {
  const now = '2026-10-09T00:00:00.000Z';
  const dm = (
    requestSenderActorId: string,
    policyRevision: number,
  ): ChannelAuthorizationFact => ({
    ...channel,
    policyKey: 'social.dm',
    policyRevision,
    authority: {
      kind: 'dm',
      lowActorId: 'a',
      highActorId: 'b',
      requestSenderActorId,
      state: 'accepted',
      blocked: false,
      revision: 1,
    },
  });
  const minor = (friends: readonly string[]) => {
    const row = adultAccount('b');
    return {
      ...row,
      account: { ...row.account, ageBand: '13-15' as const },
      age: { ...row.age, band: '13-15' as const },
      contact: { ...row.contact, friendActorIds: friends },
    };
  };
  const adult = (friends: readonly string[]) => {
    const row = adultAccount('a');
    return { ...row, contact: { ...row.contact, friendActorIds: friends } };
  };
  const posting = (
    fact: ChannelAuthorizationFact,
    accounts: Parameters<typeof socialPostingPolicy>[0]['accounts'],
  ) =>
    socialPostingPolicy({ channel: fact, accounts, now, policy: betaDmPolicy })
      .allowed;
  test('revision-1 and revision-2 channels', () =>
    assert({
      given: 'two adults on a revision-1, revision-2 and unknown-revision DM',
      should: 'post on the current and the honoured revision only',
      actual: [
        posting(dm('a', 1), [adult([]), adultAccount('b')]),
        posting(dm('a', 2), [adult([]), adultAccount('b')]),
        posting(dm('a', 3), [adult([]), adultAccount('b')]),
      ],
      expected: [true, true, false],
    }));
  test('friendship is the basis of an adult-initiated DM with a minor', () =>
    assert({
      given: 'an adult-initiated DM with a 13-15, as friends and then not',
      should: 'post while they are friends and stop once unfriended',
      actual: [
        posting(dm('a', 2), [adult(['b']), minor(['a'])]),
        posting(dm('a', 2), [adult([]), minor([])]),
        // The minor asked: no friendship needed; block is the way out.
        posting(dm('b', 2), [adult([]), minor([])]),
        posting(
          {
            ...dm('b', 2),
            authority: { ...dm('b', 2).authority, blocked: true },
          } as ChannelAuthorizationFact,
          [adult([]), minor([])],
        ),
      ],
      expected: [true, false, true, false],
    }));
});
