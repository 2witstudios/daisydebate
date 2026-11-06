import { assert, setupRitewayBun, test } from 'riteway/bun';
import { buildEconomicsReport } from './economics-report';
setupRitewayBun();
import { now, month, measured, dataset } from './economics.test-support';
test('measured completed source-month reporting keeps late refunds and provider costs independent of allowance restoration', () => {
  const input = dataset();
  input.revenue.push({
    sequence: 2,
    plan: 'premium',
    sourceMonth: month,
    observedAt: now,
    kind: 'refund',
    money: measured(1000000),
  });
  const result = buildEconomicsReport(input, now);
  assert({
    given:
      'a measured month with a later original-period money refund and one thousand unlimited judges',
    should:
      'reduce original-month revenue, retain measured cost and volume without pretending concurrency bounds spend',
    actual: result.kind === 'report' && [
      result.plans.premium.margin.kind,
      result.plans.premium.revenueAfterRefunds,
      result.volume,
    ],
    expected: ['below_floor', measured(9000000), input.volume],
  });
});
test('missing measurements, estimated rates, conflicting rates and unknown calls cannot produce a healthy measured month', () => {
  const input = dataset();
  const variants = [
    {
      ...input,
      coverage: input.coverage.filter((x) => x.category !== 'storage'),
    },
    {
      ...input,
      costs: [
        {
          ...input.costs[0],
          money: { kind: 'unknown', reason: 'outcome_unknown' },
        },
      ],
    },
    {
      ...input,
      costs: [],
      modelUsage: [
        {
          sequence: 1,
          plan: 'premium',
          evidence: 'unknown',
          model: 'configured-model',
          provider: 'recorded-provider',
          occurredAt: month,
          throughAt: month,
          observedAt: now,
          inputTokens: 100,
          outputTokens: null,
        },
      ],
    },
  ];
  assert({
    given:
      'missing storage coverage, an unresolved provider expense, or unknown output usage',
    should: 'retain incomplete cost instead of zero or healthy',
    actual: variants.map((x) => {
      const r = buildEconomicsReport(x, now);
      return r.kind === 'report' && r.plans.premium.margin.kind;
    }),
    expected: ['unknown', 'unknown', 'unknown'],
  });
});
test('unexpected personal dimensions fail before private report construction', () => {
  const r = buildEconomicsReport(
    { ...dataset(), userId: 'private-person' },
    now,
  );
  assert({
    given: 'an account dimension mixed into the aggregate feed',
    should: 'return only a fixed invalid-input status',
    actual: r,
    expected: { kind: 'invalid', reason: 'invalid_input' },
  });
});

test('malformed source months or misleading allocation rules cannot disappear into complete zero costs', () => {
  const input = dataset();
  const cost = input.costs[0]!;
  const variants = [
    { ...input, costs: [{ ...cost, sourceMonth: '2026-10-02T00:00:00.000Z' }] },
    {
      ...input,
      costs: [
        {
          ...cost,
          allocation: {
            rule: 'free_subsidy',
            shares: [{ plan: 'premium', basisPoints: 10000 }],
          },
        },
      ],
    },
    {
      ...input,
      costs: [
        {
          ...cost,
          allocation: {
            rule: 'equal_share',
            shares: [
              { plan: 'premium', basisPoints: 9000 },
              { plan: 'free', basisPoints: 1000 },
            ],
          },
        },
      ],
    },
  ];
  assert({
    given:
      'a noncanonical source month, an unlabeled subsidy, or an unequal supposedly equal allocation',
    should: 'reject the input before any measured margin verdict',
    actual: variants.map((v) => buildEconomicsReport(v, now).kind),
    expected: ['invalid', 'invalid', 'invalid'],
  });
});
