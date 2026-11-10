import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import {
  createBillingEconomicsCollector,
  economicsFailureCode,
} from './economics-collector';
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
test('a missing private feed is reported incomplete, never measured zero', async () => {
  const saved: unknown[] = [];
  const collector = createBillingEconomicsCollector({
    sink: { open: async () => undefined },
    store: { read: async () => snapshot() },
    feed: { read: async () => null },
    now: () => now,
    save: async (r) => {
      saved.push(r);
    },
  });
  const result = await collector.run(window);
  assert({
    given: 'an empty real-source projection and no private measurement feed',
    should:
      'save an unknown-economics report recorded as feed_missing with completeness signals for every plan, never measured zero or threshold success',
    actual: result.kind === 'reported' && [
      result.month,
      result.feed,
      result.report.kind === 'report' &&
        result.report.plans.premium.margin.kind,
      result.signals,
      saved.length,
    ],
    expected: [
      '2026-10',
      'missing',
      'unknown',
      [
        { name: 'BILLING_ECONOMICS_INCOMPLETE', plan: 'free' },
        { name: 'BILLING_ECONOMICS_INCOMPLETE', plan: 'beta' },
        { name: 'BILLING_ECONOMICS_INCOMPLETE', plan: 'premium' },
      ],
      1,
    ],
  });
});
test('each failing stage is one typed failure carrying the caught error', async () => {
  const cause = new Error('private detail');
  const run = (
    overrides: Partial<Parameters<typeof createBillingEconomicsCollector>[0]>,
  ) =>
    createBillingEconomicsCollector({
      sink: { open: async () => undefined },
      store: { read: async () => snapshot() },
      feed: { read: async () => feed() },
      now: () => now,
      save: async () => undefined,
      ...overrides,
    }).run(window);
  const results = await Promise.all([
    run({
      sink: {
        open: async () => {
          throw cause;
        },
      },
    }),
    run({
      store: {
        read: async () => {
          throw cause;
        },
      },
    }),
    run({
      feed: {
        read: async () => {
          throw cause;
        },
      },
    }),
    run({
      save: async () => {
        throw cause;
      },
    }),
  ]);
  assert({
    given:
      'an unavailable sink, an unreadable snapshot, an unreadable feed, and a failing save',
    should:
      'return sink_unavailable, snapshot_failed, feed_unreadable and save_failed for the month, each keeping the caught error',
    actual: results,
    expected: [
      { kind: 'failed', month: '2026-10', reason: 'sink_unavailable', cause },
      { kind: 'failed', month: '2026-10', reason: 'snapshot_failed', cause },
      { kind: 'failed', month: '2026-10', reason: 'feed_unreadable', cause },
      { kind: 'failed', month: '2026-10', reason: 'save_failed', cause },
    ],
  });
});
test('a feed stating another floor is refused as invalid by the collector itself', async () => {
  const saved: unknown[] = [];
  const r = await createBillingEconomicsCollector({
    sink: { open: async () => undefined },
    store: { read: async () => snapshot() },
    feed: { read: async () => ({ ...feed(), floorBasisPoints: 1000 }) },
    now: () => now,
    save: async (value) => {
      saved.push(value);
    },
  }).run(window);
  assert({
    given:
      'a private feed attempting a 10% floor against the recorded 30% policy',
    should:
      'fail as feed_invalid without saving a report, whatever the composition',
    actual: [r.kind === 'failed' && r.reason, saved],
    expected: ['feed_invalid', []],
  });
});
test('bounded projection overflow defeats apparently complete external invoices', async () => {
  const collector = createBillingEconomicsCollector({
    sink: { open: async () => undefined },
    store: { read: async () => ({ ...snapshot(), complete: false }) },
    feed: { read: async () => feed() },
    now: () => now,
    save: async () => undefined,
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
    sink: { open: async () => undefined },
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
  });
  const r = await collector.run(window);
  assert({
    given: 'a mismatched durable snapshot',
    should: 'fail as snapshot_invalid without saving a misleading report',
    actual: [r.kind === 'failed' && r.reason, saved],
    expected: ['snapshot_invalid', []],
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
    sink: { open: async () => undefined },
    store: { read: async () => snapshot() },
    feed: { read: async () => input },
    now: () => now,
    save: async () => undefined,
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
    sink: { open: async () => undefined },
    store: { read: async () => snapshot() },
    feed: {
      read: async () => ({ ...feed(), startsAt: '2026-09-01T00:00:00.000Z' }),
    },
    now: () => now,
    save: async () => undefined,
  });
  const r = await collector.run(window);
  assert({
    given: 'a private completeness receipt bound to another month',
    should: 'fail the exact reporting window as feed_invalid',
    actual: r.kind === 'failed' && r.reason,
    expected: 'feed_invalid',
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
    unmeasuredResponses: 0,
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
    sink: { open: async () => undefined },
    store: { read: async () => ({ ...snapshot(), attempts: [attempt] }) },
    feed: { read: async () => input },
    now: () => now,
    save: async () => undefined,
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

test('a malformed feed body is invalid, and an incoherent report is report_invalid', async () => {
  const saved: unknown[] = [];
  const run = (read: () => Promise<unknown>) =>
    createBillingEconomicsCollector({
      sink: { open: async () => undefined },
      store: { read: async () => snapshot() },
      feed: { read },
      now: () => now,
      save: async (value) => {
        saved.push(value);
      },
    }).run(window);
  const malformed = await run(async () => {
    throw createAppError('VALIDATION', 'Billing economics feed is invalid');
  });
  const unreadable = await run(async () => {
    throw new Error('Billing economics feed unavailable');
  });
  const incoherent = await run(async () => {
    const supplied = feed();
    return { ...supplied, revenue: [...supplied.revenue, ...supplied.revenue] };
  });
  assert({
    given:
      'a feed whose contents the files edge refused as VALIDATION, an unreadable feed, and a feed whose revenue sequences repeat',
    should:
      'fail as feed_invalid, feed_unreadable and report_invalid, and save nothing',
    actual: [
      malformed.kind === 'failed' && malformed.reason,
      unreadable.kind === 'failed' && unreadable.reason,
      incoherent.kind === 'failed' && incoherent.reason,
      saved,
    ],
    expected: ['feed_invalid', 'feed_unreadable', 'report_invalid', []],
  });
});

test('a throw while building the report is report_failed, never blamed on the feed', async () => {
  let calls = 0;
  const r = await createBillingEconomicsCollector({
    sink: { open: async () => undefined },
    store: { read: async () => snapshot() },
    feed: { read: async () => feed() },
    // The snapshot check reads the clock first; the builder's read throws.
    now: () => {
      if (++calls > 1) throw new Error('builder defect');
      return now;
    },
    save: async () => undefined,
  }).run(window);
  assert({
    given:
      'a valid snapshot and feed, and a throw inside the report build stage',
    should: 'fail as report_failed, not feed_invalid',
    actual: r.kind === 'failed' && r.reason,
    expected: 'report_failed',
  });
});

test('each failure reason is reported under its fixed error code', () => {
  assert({
    given: 'the closed set of collection failure reasons',
    should:
      'map bad data to VALIDATION, a defect to INTERNAL, and an unavailable resource to INFRASTRUCTURE',
    actual: economicsFailureCode,
    expected: {
      sink_unavailable: 'INFRASTRUCTURE',
      snapshot_failed: 'INFRASTRUCTURE',
      snapshot_invalid: 'VALIDATION',
      feed_unreadable: 'INFRASTRUCTURE',
      feed_invalid: 'VALIDATION',
      report_invalid: 'VALIDATION',
      report_failed: 'INTERNAL',
      save_failed: 'INFRASTRUCTURE',
    },
  });
});
