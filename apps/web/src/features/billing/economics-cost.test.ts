import { assert, setupRitewayBun, test } from 'riteway/bun';
import { allocateEconomics, priceModelUsage } from './economics-cost';
import { economicsInput } from './economics-input';
import { dataset, month, now } from './economics.test-support';
setupRitewayBun();
test('effective-dated rates price the recorded model and keep estimates and possible calls explicit', () => {
  const usage = {
    sequence: 1,
    plan: 'premium' as const,
    evidence: 'provider_response' as const,
    model: 'historic-model',
    provider: 'recorded-provider',
    occurredAt: month,
    throughAt: month,
    observedAt: now,
    inputTokens: 1000000,
    outputTokens: 1000000,
  };
  const rate = {
    model: 'historic-model',
    provider: 'recorded-provider',
    effectiveFrom: month,
    effectiveUntil: null,
    observedAt: now,
    provenance: 'billed_rate' as const,
    inputMicrosPerMillion: 2000000,
    outputMicrosPerMillion: 10000000,
  };
  const results = [
    priceModelUsage(usage, [rate]),
    priceModelUsage(usage, [{ ...rate, provenance: 'catalog_estimate' }]),
    priceModelUsage(usage, [rate, rate]),
    priceModelUsage(
      { ...usage, evidence: 'unknown', inputTokens: 0, outputTokens: 0 },
      [rate],
    ),
    priceModelUsage(usage, [{ ...rate, effectiveFrom: now }]),
  ];
  assert({
    given:
      'recorded historical model usage and a dated billed rate, estimated rate, overlapping rate, default zero counters, or no effective rate',
    should:
      'price only the unique effective schedule with exact micros and preserve every unknown',
    actual: results,
    expected: [
      { kind: 'measured', amountMicros: 12000000 },
      { kind: 'estimated', amountMicros: 12000000 },
      { kind: 'unknown', reason: 'rate_missing' },
      { kind: 'unknown', reason: 'outcome_unknown' },
      { kind: 'unknown', reason: 'rate_missing' },
    ],
  });
});
test('shared expenses and expense credits conserve every micro-unit across explicit plan allocation', () => {
  const base = economicsInput.parse(dataset()).costs[0]!;
  const shares = [
    { plan: 'premium' as const, basisPoints: 5000 },
    { plan: 'free' as const, basisPoints: 5000 },
  ];
  const actual = [5, -5].map((amountMicros) =>
    allocateEconomics({
      ...base,
      money: { kind: 'measured', amountMicros },
      allocation: { rule: 'usage_share', shares },
    }).map((x) => x.money),
  );
  assert({
    given:
      'a signed shared invoice amount that is not evenly divisible between plans',
    should:
      'allocate the rounding remainder deterministically while preserving the original signed total',
    actual,
    expected: [
      [
        { kind: 'measured', amountMicros: 3 },
        { kind: 'measured', amountMicros: 2 },
      ],
      [
        { kind: 'measured', amountMicros: -3 },
        { kind: 'measured', amountMicros: -2 },
      ],
    ],
  });
});

test('a dated aggregate that crosses a price change or overlaps an interior rate is not silently priced at its first instant', () => {
  const usage = {
    sequence: 1,
    plan: 'premium' as const,
    evidence: 'provider_response' as const,
    model: 'historic-model',
    provider: 'recorded-provider',
    occurredAt: month,
    throughAt: '2026-10-02T00:00:00.000Z',
    observedAt: now,
    inputTokens: 100,
    outputTokens: 20,
  };
  const rate = {
    model: 'historic-model',
    provider: 'recorded-provider',
    effectiveFrom: month,
    effectiveUntil: null,
    observedAt: now,
    provenance: 'billed_rate' as const,
    inputMicrosPerMillion: 2000000,
    outputMicrosPerMillion: 10000000,
  };
  const interior = {
    ...rate,
    effectiveFrom: '2026-10-01T12:00:00.000Z',
    effectiveUntil: '2026-10-01T13:00:00.000Z',
  };
  assert({
    given:
      'an aggregate spanning multiple effective prices or an overlapping middle price',
    should: 'remain unknown until the usage is split with actual rate evidence',
    actual: [
      priceModelUsage(usage, [
        { ...rate, effectiveUntil: interior.effectiveFrom },
        { ...rate, effectiveFrom: interior.effectiveFrom },
      ]).kind,
      priceModelUsage(usage, [rate, interior]).kind,
    ],
    expected: ['unknown', 'unknown'],
  });
});
