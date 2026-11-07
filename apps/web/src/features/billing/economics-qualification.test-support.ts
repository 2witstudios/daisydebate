import { dataset, month, now } from './economics.test-support';
import { economicsInput, type EconomicsInput } from './economics-input';

/** Hypothetical TEST accounting assumptions, never supplier invoices or observed workload. */
export const estimateAssumptions = {
  basis: 'hypothetical_TEST_estimates_not_actual_billing_or_workload',
  sourceDate: now,
  model:
    'Fictional qualification model: 1M input and 0.1M output tokens at assumed USD2/USD10 per million; not a published vendor quote.',
  revenue:
    'Assume USD10 October receipts and USD1 refund recognized in November against the SAME October source month.',
  storage:
    'Assume 2GB-month at USD0.05/GB-month, excluding all other expense lines.',
  shared:
    'Assume USD1 residual platform expense, allocated using declared TEST usage weights3:1 premium/free; not an observed workload.',
  subsidy:
    'Assume USD0.20 otherwise unallocated free-tier expense funded entirely by Premium; excluded from every other cost line.',
  other:
    'Assume disjoint speech0.40, recording2.50, broadcast0.30 and payment-fees0.60 USD; none are supplier measurements.',
  unknown:
    'No beta/free revenue coverage, capture/download measurements or capacity observation is supplied; retain unknown.',
} as const;

export function estimateQualification() {
  const cost = (
    sequence: number,
    category: EconomicsInput['costs'][number]['category'],
    amountMicros: number,
    allocation: EconomicsInput['costs'][number]['allocation'] = {
      rule: 'direct',
      shares: [{ plan: 'premium', basisPoints: 10000 }],
    },
  ) => ({
    sequence,
    category,
    sourceMonth: month,
    observedAt: now,
    allocation,
    money: { kind: 'estimated' as const, amountMicros },
  });
  const input = economicsInput.parse({
    ...dataset(),
    revenue: [
      {
        sequence: 1,
        plan: 'premium',
        sourceMonth: month,
        observedAt: now,
        kind: 'receipt',
        money: { kind: 'estimated', amountMicros: 10000000 },
      },
      {
        sequence: 2,
        plan: 'premium',
        sourceMonth: month,
        observedAt: now,
        kind: 'refund',
        money: { kind: 'estimated', amountMicros: 1000000 },
      },
    ],
    costs: [
      cost(1, 'speech', 400000),
      cost(2, 'recording', 2500000),
      cost(3, 'broadcast', 300000),
      cost(4, 'storage', 100000),
      cost(5, 'paymentFees', 600000),
      cost(6, 'shared', 1000000, {
        rule: 'usage_share',
        shares: [
          { plan: 'premium', basisPoints: 7500 },
          { plan: 'free', basisPoints: 2500 },
        ],
      }),
      cost(7, 'freeTierSubsidy', 200000, {
        rule: 'free_subsidy',
        shares: [{ plan: 'premium', basisPoints: 10000 }],
      }),
    ],
    coverage: dataset().coverage.map((row) => ({ ...row, kind: 'estimated' })),
    revenueCoverage: [{ plan: 'premium', kind: 'estimated' }],
    rates: [
      {
        model: 'qualification-model',
        provider: 'qualification-provider',
        effectiveFrom: '2026-09-01T00:00:00.000Z',
        effectiveUntil: '2026-11-01T00:00:00.000Z',
        observedAt: now,
        provenance: 'catalog_estimate',
        inputMicrosPerMillion: 2000000,
        outputMicrosPerMillion: 10000000,
      },
    ],
    volume: [],
  });
  const { modelUsage: _unused, ...feed } = input;
  void _unused;
  return {
    feed: { ...feed, modelCostBasis: 'usage_counters' },
    snapshot: {
      startsAt: month,
      endsAt: input.endsAt,
      observedAt: now,
      complete: true,
      usage: [],
      attempts: [
        {
          sourceKind: 'subscription',
          sourceStartsAt: month,
          sourceEndsAt: input.endsAt,
          feature: 'casual_ai_judge',
          provider: 'qualification-provider',
          model: 'qualification-model',
          firstAt: '2026-10-15T00:00:00.000Z',
          lastAt: '2026-10-15T00:00:00.000Z',
          runs: 1,
          knownResponses: 1,
          unmeasuredResponses: 0,
          unknownCalls: 0,
          definiteFailures: 0,
          inputTokens: 1000000,
          outputTokens: 100000,
          characters: 0,
        },
      ],
    },
  };
}
