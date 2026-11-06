import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createBillingEconomicsCollector } from './economics-collector';
import { dataset, month, now } from './economics.test-support';
setupRitewayBun();
const window = { startsAt: month, endsAt: '2026-11-01T00:00:00.000Z' };
const snapshot = () => ({
  ...window,
  observedAt: now,
  complete: true,
  attempts: [],
  usage: [],
});
const feed = () => {
  const { modelUsage: _m, volume: _v, ...data } = dataset();
  void _m;
  void _v;
  return { ...data, modelCostBasis: 'provider_invoice' };
};
test('missing private invoices and rates stay incomplete even with an empty current database', async () => {
  const signals: string[] = [];
  const collector = createBillingEconomicsCollector({
    store: { read: async () => snapshot() },
    feed: { read: async () => null },
    now: () => now,
    save: async () => undefined,
    reporter: {
      capture: (_e, c) => {
        signals.push(c.errorCode);
      },
    },
  });
  const result = await collector.run(window);
  assert({
    given: 'an empty real-source projection and no private measurement feed',
    should:
      'report unknown economics and send completeness signals, never measured zero or threshold success',
    actual: result.kind === 'reported' && [
      result.report.kind === 'report' &&
        result.report.plans.premium.margin.kind,
      signals,
    ],
    expected: [
      'unknown',
      [
        'BILLING_ECONOMICS_INCOMPLETE',
        'BILLING_ECONOMICS_INCOMPLETE',
        'BILLING_ECONOMICS_INCOMPLETE',
      ],
    ],
  });
});
test('bounded projection overflow defeats apparently complete external invoices', async () => {
  const collector = createBillingEconomicsCollector({
    store: { read: async () => ({ ...snapshot(), complete: false }) },
    feed: { read: async () => feed() },
    now: () => now,
    save: async () => undefined,
    reporter: { capture: () => undefined },
  });
  const r = await collector.run(window);
  assert({
    given:
      'an incomplete durable-source projection paired with measured invoice inputs',
    should:
      'retain incomplete attribution and refuse a low-margin or healthy measured verdict',
    actual:
      r.kind === 'reported' &&
      r.report.kind === 'report' &&
      r.report.plans.premium.margin.kind,
    expected: 'unknown',
  });
});
test('a snapshot for a different window cannot silently price this month', async () => {
  const saved: unknown[] = [];
  const collector = createBillingEconomicsCollector({
    store: {
      read: async () => ({
        ...snapshot(),
        startsAt: '2026-09-01T00:00:00.000Z',
      }),
    },
    feed: { read: async () => feed() },
    now: () => now,
    save: async (r) => {
      saved.push(r);
    },
    reporter: { capture: () => undefined },
  });
  const r = await collector.run(window);
  assert({
    given: 'a mismatched durable snapshot',
    should: 'fail without saving a misleading report',
    actual: [r.kind, saved],
    expected: ['failed', []],
  });
});

test('unlimited feature measurements remain separate from a completed-month margin crossing', async () => {
  const input = {
    ...feed(),
    volume: [
      {
        plan: 'premium',
        feature: 'casual_ai_judge',
        completed: 999,
        possibleCalls: 999,
        capacity: { kind: 'measured', peak: 1, limit: 1 },
      },
      {
        plan: 'premium',
        feature: 'recording_download',
        completed: 2000,
        possibleCalls: null,
        capacity: { kind: 'unknown' },
      },
    ],
  };
  const collector = createBillingEconomicsCollector({
    store: { read: async () => snapshot() },
    feed: { read: async () => input },
    now: () => now,
    save: async () => undefined,
    reporter: { capture: () => undefined },
  });
  const r = await collector.run(window);
  const report =
    r.kind === 'reported' && r.report.kind === 'report' ? r.report : null;
  assert({
    given:
      'a measured capacity peak of one, external download volume, and a low-margin month',
    should:
      'retain capacity and volume independently, never turn concurrency into a spend ceiling or overwrite actual ledger counts',
    actual: report && [
      report.plans.premium.margin.kind,
      report.volume.find(
        (v) => v.plan === 'premium' && v.feature === 'casual_ai_judge',
      ),
      report.volume.find(
        (v) => v.plan === 'premium' && v.feature === 'recording_download',
      ),
      report.volume.find(
        (v) => v.plan === 'free' && v.feature === 'recording_download',
      ),
    ],
    expected: [
      'below_floor',
      {
        plan: 'premium',
        feature: 'casual_ai_judge',
        completed: 0,
        possibleCalls: 0,
        capacity: { kind: 'measured', peak: 1, limit: 1 },
      },
      {
        plan: 'premium',
        feature: 'recording_download',
        completed: 2000,
        possibleCalls: null,
        capacity: { kind: 'unknown' },
      },
      {
        plan: 'free',
        feature: 'recording_download',
        completed: null,
        possibleCalls: null,
        capacity: { kind: 'unknown' },
      },
    ],
  });
});
test('a private feed for another month fails instead of declaring complete current cost', async () => {
  const collector = createBillingEconomicsCollector({
    store: { read: async () => snapshot() },
    feed: {
      read: async () => ({ ...feed(), startsAt: '2026-09-01T00:00:00.000Z' }),
    },
    now: () => now,
    save: async () => undefined,
    reporter: { capture: () => undefined },
  });
  const r = await collector.run(window);
  assert({
    given: 'a private completeness receipt bound to another month',
    should: 'fail the exact reporting window',
    actual: r.kind,
    expected: 'failed',
  });
});
test('possible unknown calls cannot be priced as measured zero even when a billed token rate exists', async () => {
  const attempt = {
    sourceKind: 'subscription',
    sourceStartsAt: '2026-09-20T00:00:00.000Z',
    sourceEndsAt: '2026-10-20T00:00:00.000Z',
    feature: 'ai_round',
    model: 'actual-model',
    provider: 'openrouter',
    firstAt: month,
    lastAt: month,
    runs: 1,
    knownResponses: 0,
    unknownCalls: 1,
    definiteFailures: 0,
    inputTokens: 0,
    outputTokens: 0,
    characters: 0,
  };
  const input = {
    ...feed(),
    modelCostBasis: 'usage_counters',
    costs: [],
    rates: [
      {
        model: 'actual-model',
        provider: 'openrouter',
        effectiveFrom: month,
        effectiveUntil: null,
        observedAt: now,
        provenance: 'billed_rate',
        inputMicrosPerMillion: 2000000,
        outputMicrosPerMillion: 10000000,
      },
    ],
  };
  const collector = createBillingEconomicsCollector({
    store: { read: async () => ({ ...snapshot(), attempts: [attempt] }) },
    feed: { read: async () => input },
    now: () => now,
    save: async () => undefined,
    reporter: { capture: () => undefined },
  });
  const r = await collector.run(window);
  assert({
    given:
      'an unanswered possible call with default zero counters and a known historical rate',
    should:
      'keep its money exposure unknown rather than healthy zero-cost usage',
    actual:
      r.kind === 'reported' &&
      r.report.kind === 'report' &&
      r.report.plans.premium.margin.kind,
    expected: 'unknown',
  });
});
