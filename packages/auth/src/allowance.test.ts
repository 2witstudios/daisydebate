import { assert, setupRitewayBun, test } from 'riteway/bun';
import { entitlementKinds } from '@daisy/protocol';
import type {
  AllowanceFacts,
  AllowanceRequest,
  UsageSource,
} from '@daisy/protocol/billing';
import { admitAllowance } from './allowance';
import { input } from './channel.test-support';

setupRitewayBun();

const now = '2026-11-05T00:00:00.000Z';
const period = {
  subscriptionId: 'sub_A',
  startsAt: '2026-11-02T12:00:00.000Z',
  endsAt: '2026-12-02T12:00:00.000Z',
};
const source: UsageSource = { kind: 'subscription', ...period };
const free: UsageSource = { kind: 'lifetime' };
const beta: UsageSource = {
  kind: 'beta',
  startsAt: '2026-11-01T00:00:00.000Z',
  endsAt: '2026-12-01T00:00:00.000Z',
};
const facts: AllowanceFacts = {
  billing: null,
  grants: [],
  usage: [],
  freeBotRoundId: null,
};
const policy = { now, betaGrantsPremium: false, betaMonthlyCap: 20 };
const bot: AllowanceRequest = {
  kind: 'bot_debate',
  roundId: 'round_A',
  withJudge: false,
};
const paid: AllowanceFacts = {
  ...facts,
  billing: {
    lifecycle: 'active',
    settlement: { kind: 'paid', period, invoiceId: 'in_paid' },
  },
  grants: entitlementKinds.map((entitlement) => ({
    entitlement,
    source: 'subscription',
    startsAt: period.startsAt,
    expiresAt: period.endsAt,
  })),
};
const decide = (
  state: AllowanceFacts,
  request: AllowanceRequest = bot,
  time = now,
) =>
  admitAllowance(input.context.account!, state, request, {
    ...policy,
    now: time,
  });

test('free allowance never bypasses current participant admission or account revocation', () => {
  const account = input.context.account!;
  const accounts = [
    null,
    { ...account, member: false },
    { ...account, erased: true },
    { ...account, restricted: true },
    { ...account, beta: { state: 'pending' as const, revision: 1 } },
    { ...account, beta: { state: 'revoked' as const, revision: 2 } },
    { ...account, ageBand: null },
    { ...account, ageBand: 'under-13' as const },
    account,
  ];
  assert({
    given:
      'missing, closed, suspended, unapproved and under-age accounts with unused lifetime allowance',
    should:
      'admit only the currently eligible participant, independent of whether beta benefits are retired',
    actual: accounts.map(
      (subject) => admitAllowance(subject, facts, bot, policy).kind,
    ),
    expected: [
      'refuse',
      'refuse',
      'refuse',
      'refuse',
      'refuse',
      'refuse',
      'refuse',
      'refuse',
      'admit',
    ],
  });
});

test('free allowances never reset at a month edge', () => {
  const spent = {
    ...facts,
    usage: [{ kind: 'ai_round' as const, source: free, spent: 1 }],
  };
  assert({
    given:
      'an unused lifetime bot allowance, then its counted use across two months',
    should: 'admit once and refuse both later dates without a monthly reset',
    actual: [
      decide(facts),
      decide(spent),
      decide(spent, bot, '2026-12-05T00:00:00.000Z'),
    ],
    expected: [
      {
        kind: 'admit',
        reservations: [{ kind: 'ai_round', source: free, limit: 1 }],
      },
      { kind: 'refuse', reason: 'allowance' },
      { kind: 'refuse', reason: 'allowance' },
    ],
  });
});

test('the paid quota belongs to the Stripe period and never falls back to unused free or beta quota', () => {
  const exhausted = {
    ...paid,
    usage: [{ kind: 'ai_round' as const, source, spent: 5 }],
  };
  const previous = {
    kind: 'subscription' as const,
    ...period,
    startsAt: '2026-10-02T12:00:00.000Z',
    endsAt: period.startsAt,
  };
  assert({
    given:
      'four current uses, five uses and five uses attributed to the prior Stripe period',
    should:
      'admit the final current use, refuse exhaustion, and leave old attribution out of the new limit',
    actual: [
      decide({ ...paid, usage: [{ kind: 'ai_round', source, spent: 4 }] }),
      decide(exhausted),
      decide({
        ...paid,
        usage: [{ kind: 'ai_round', source: previous, spent: 5 }],
      }),
    ],
    expected: [
      { kind: 'admit', reservations: [{ kind: 'ai_round', source, limit: 5 }] },
      { kind: 'refuse', reason: 'allowance' },
      { kind: 'admit', reservations: [{ kind: 'ai_round', source, limit: 5 }] },
    ],
  });
});

test('beta retirement changes the selected source without erasing prior use', () => {
  const enabled = { ...policy, betaGrantsPremium: true };
  const state: AllowanceFacts = {
    ...facts,
    grants: [{ entitlement: 'ai_rounds', source: 'beta' }],
    usage: [{ kind: 'ai_round', source: free, spent: 1 }],
  };
  assert({
    given: 'a used free allowance and a beta grant enabled then retired',
    should:
      'use the beta month while enabled and preserve lifetime exhaustion after retirement',
    actual: [
      admitAllowance(input.context.account!, state, bot, enabled),
      decide(state),
    ],
    expected: [
      {
        kind: 'admit',
        reservations: [{ kind: 'ai_round', source: beta, limit: 20 }],
      },
      { kind: 'refuse', reason: 'allowance' },
    ],
  });
});

test('grace blocks new bots and source fallback while other valid Premium capabilities remain', () => {
  const grace: AllowanceFacts = {
    ...paid,
    billing: {
      lifecycle: 'past_due',
      settlement: {
        kind: 'renewal_failed',
        invoiceId: 'in_failed',
        period: {
          ...period,
          startsAt: period.endsAt,
          endsAt: '2027-01-02T12:00:00.000Z',
        },
        previous: { invoiceId: 'in_paid', period },
      },
    },
    grants: paid.grants.map((grant) => ({
      ...grant,
      startsAt: period.endsAt,
      expiresAt: '2026-12-09T12:00:00.000Z',
    })),
  };
  assert({
    given:
      'renewal grace and then its exact expiration with untouched free allowances',
    should:
      'deny new bots during grace, allow included judging, and restore ordinary unused free eligibility only after grace ends',
    actual: [
      decide(grace, bot, period.endsAt),
      decide(
        grace,
        { kind: 'casual_judge', roundId: 'human_round' },
        period.endsAt,
      ),
      decide(grace, bot, '2026-12-09T12:00:00.000Z'),
    ],
    expected: [
      { kind: 'refuse', reason: 'renewal-grace' },
      {
        kind: 'admit',
        reservations: [{ kind: 'casual_ai_judge', source, limit: null }],
      },
      {
        kind: 'admit',
        reservations: [{ kind: 'ai_round', source: free, limit: 1 }],
      },
    ],
  });
});

test('optional free bot and judge form one atomic admission decision', () => {
  const bundle = { ...bot, withJudge: true };
  assert({
    given:
      'an unused bundle, a spent judge, a free judge on the bound Round and one on another Round',
    should:
      'admit both together or neither, and never transfer the free judge to another Round',
    actual: [
      decide(facts, bundle),
      decide(
        {
          ...facts,
          usage: [{ kind: 'casual_ai_judge', source: free, spent: 1 }],
        },
        bundle,
      ),
      decide(
        { ...facts, freeBotRoundId: 'round_A' },
        { kind: 'casual_judge', roundId: 'round_A' },
      ),
      decide(
        { ...facts, freeBotRoundId: 'round_A' },
        { kind: 'casual_judge', roundId: 'human_round' },
      ),
      decide(facts, { kind: 'casual_judge', roundId: 'human_round' }),
    ],
    expected: [
      {
        kind: 'admit',
        reservations: [
          { kind: 'ai_round', source: free, limit: 1 },
          { kind: 'casual_ai_judge', source: free, limit: 1 },
        ],
      },
      { kind: 'refuse', reason: 'allowance' },
      {
        kind: 'admit',
        reservations: [{ kind: 'casual_ai_judge', source: free, limit: 1 }],
      },
      { kind: 'refuse', reason: 'free-judge-unbound' },
      { kind: 'refuse', reason: 'free-judge-unbound' },
    ],
  });
});

test('paid analysis and casual judging are included without a monthly quantity cap', () => {
  assert({
    given: 'many already counted paid requests',
    should:
      'retain included access while feature capacity and request identity are checked separately',
    actual: (['round_analysis', 'casual_judge'] as const).map((kind) =>
      decide(
        {
          ...paid,
          usage: [
            { kind: 'round_analysis', source, spent: 99 },
            { kind: 'casual_ai_judge', source, spent: 99 },
          ],
        },
        { kind, roundId: 'round_A' },
      ),
    ),
    expected: [
      {
        kind: 'admit',
        reservations: [{ kind: 'round_analysis', source, limit: null }],
      },
      {
        kind: 'admit',
        reservations: [{ kind: 'casual_ai_judge', source, limit: null }],
      },
    ],
  });
});

test('a refunded free judge cannot transfer through a replacement bot bundle', () => {
  const refunded: AllowanceFacts = {
    ...facts,
    freeBotRoundId: 'round_original',
    usage: [
      { kind: 'ai_round', source: free, spent: 0 },
      { kind: 'casual_ai_judge', source: free, spent: 0 },
    ],
  };
  assert({
    given:
      'both dispatched free jobs failed and refunded while their original Round binding remains',
    should:
      'refuse judge transfer in standalone and bundled paths, while allowing a refunded bot alone',
    actual: [
      decide(refunded, { kind: 'casual_judge', roundId: 'round_replacement' }),
      decide(refunded, {
        kind: 'bot_debate',
        roundId: 'round_replacement',
        withJudge: true,
      }),
      decide(refunded, {
        kind: 'bot_debate',
        roundId: 'round_replacement',
        withJudge: false,
      }),
    ],
    expected: [
      { kind: 'refuse', reason: 'free-judge-unbound' },
      { kind: 'refuse', reason: 'free-judge-unbound' },
      {
        kind: 'admit',
        reservations: [{ kind: 'ai_round', source: free, limit: 1 }],
      },
    ],
  });
});

test('allowance never substitutes for live account authority or valid policy facts', () => {
  assert({
    given: 'erased/absent/nonmember accounts or malformed time/count/cap',
    should: 'refuse before producing reservations',
    actual: [
      admitAllowance(
        { ...input.context.account!, erased: true },
        paid,
        bot,
        policy,
      ),
      admitAllowance(null, paid, bot, policy),
      admitAllowance(
        { ...input.context.account!, member: false },
        paid,
        bot,
        policy,
      ),
      decide(paid, bot, 'invalid'),
      decide({ ...paid, usage: [{ kind: 'ai_round', source, spent: -1 }] }),
      admitAllowance(input.context.account!, paid, bot, {
        ...policy,
        betaMonthlyCap: 0,
      }),
    ],
    expected: [
      ...Array.from({ length: 3 }, () => ({
        kind: 'refuse',
        reason: 'not-eligible',
      })),
      ...Array.from({ length: 3 }, () => ({
        kind: 'refuse',
        reason: 'invalid-facts',
      })),
    ],
  });
});
