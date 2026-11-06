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
  const {
    startsAt: _s,
    endsAt: _e,
    modelUsage: _m,
    volume: _v,
    ...data
  } = dataset();
  void _s;
  void _e;
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
