import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError, isAppError } from '@daisy/errors';
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
      {
        kind: 'failed',
        month: '2026-10',
        reason: 'sink_unavailable',
        code: 'INFRASTRUCTURE',
        cause,
      },
      {
        kind: 'failed',
        month: '2026-10',
        reason: 'snapshot_failed',
        code: 'INFRASTRUCTURE',
        cause,
      },
      {
        kind: 'failed',
        month: '2026-10',
        reason: 'feed_unreadable',
        code: 'INFRASTRUCTURE',
        cause,
      },
      {
        kind: 'failed',
        month: '2026-10',
        reason: 'save_failed',
        code: 'INFRASTRUCTURE',
        cause,
      },
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
    should:
      'fail as snapshot_invalid, a typed VALIDATION window refusal, without saving a misleading report',
    actual: [
      r.kind === 'failed' && [
        r.reason,
        r.code,
        isAppError(r.cause) && r.cause.message,
      ],
      saved,
    ],
    expected: [
      ['snapshot_invalid', 'VALIDATION', 'Economics snapshot window mismatch'],
      [],
    ],
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
    // The input check and the snapshot check read the clock first; the builder's read throws.
    now: () => {
      if (++calls > 2) throw new Error('builder defect');
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
      inputs_invalid: 'INTERNAL',
      save_failed: 'INFRASTRUCTURE',
    },
  });
});

test('a malformed feed is named as malformed, never as a floor change', async () => {
  const run = (value: unknown) =>
    createBillingEconomicsCollector({
      sink: { open: async () => undefined },
      store: { read: async () => snapshot() },
      feed: { read: async () => value },
      now: () => now,
      save: async () => undefined,
    }).run(window);
  const messageOf = (r: Awaited<ReturnType<typeof run>>) =>
    r.kind === 'failed' && r.cause instanceof Error ? r.cause.message : null;
  const { floorBasisPoints: _f, ...withoutFloor } = feed();
  void _f;
  assert({
    given:
      'a feed that is an array, a number, and an object missing only the floor',
    should: 'refuse each as a schema defect',
    actual: [
      messageOf(await run([])),
      messageOf(await run(42)),
      messageOf(await run(withoutFloor)),
    ],
    expected: [
      'Economics feed schema invalid',
      'Economics feed schema invalid',
      'Economics feed schema invalid',
    ],
  });
});

test('each feed data check refuses with its own fixed VALIDATION message', async () => {
  const causeOf = async (value: unknown) => {
    const r = await createBillingEconomicsCollector({
      sink: { open: async () => undefined },
      store: { read: async () => snapshot() },
      feed: { read: async () => value },
      now: () => now,
      save: async () => undefined,
    }).run(window);
    return r.kind === 'failed' && isAppError(r.cause)
      ? [r.reason, r.cause.code, r.cause.message]
      : null;
  };
  const volume = {
    plan: 'premium',
    feature: 'casual_capture',
    completed: 1,
    possibleCalls: 1,
    capacity: { kind: 'unknown' },
  };
  assert({
    given:
      'feeds failing the schema, the floor, the window, unique capacity, and the single model cost basis',
    should:
      'refuse each as feed_invalid with VALIDATION and a distinct fixed message',
    actual: [
      await causeOf([]),
      await causeOf({ ...feed(), floorBasisPoints: 1000 }),
      await causeOf({ ...feed(), startsAt: '2026-09-01T00:00:00.000Z' }),
      await causeOf({ ...feed(), volume: [volume, volume] }),
      await causeOf({ ...feed(), modelCostBasis: 'usage_counters' }),
    ],
    expected: [
      ['feed_invalid', 'VALIDATION', 'Economics feed schema invalid'],
      [
        'feed_invalid',
        'VALIDATION',
        'Economics feed floor is not the recorded policy',
      ],
      ['feed_invalid', 'VALIDATION', 'Economics feed window mismatch'],
      ['feed_invalid', 'VALIDATION', 'Duplicate capacity measurements'],
      ['feed_invalid', 'VALIDATION', 'Conflicting model cost bases'],
    ],
  });
});

test("a defect in the join is report_failed, never the feed's fault", async () => {
  const r = await createBillingEconomicsCollector({
    sink: { open: async () => undefined },
    store: { read: async () => snapshot() },
    feed: {
      read: async () => ({
        get startsAt(): string {
          throw new TypeError('join defect');
        },
      }),
    },
    now: () => now,
    save: async () => undefined,
  }).run(window);
  assert({
    given: 'a join that throws an untyped TypeError',
    should: 'fail as report_failed (INTERNAL), not feed_invalid',
    actual: r.kind === 'failed' && [r.reason, r.code],
    expected: ['report_failed', 'INTERNAL'],
  });
});

test('an incoherent report names its check', async () => {
  const supplied = feed();
  const r = await createBillingEconomicsCollector({
    sink: { open: async () => undefined },
    store: { read: async () => snapshot() },
    feed: {
      read: async () => ({
        ...supplied,
        revenue: [...supplied.revenue, ...supplied.revenue],
      }),
    },
    now: () => now,
    save: async () => undefined,
  }).run(window);
  assert({
    given: 'a feed whose revenue sequences repeat',
    should: 'fail as report_invalid with a typed VALIDATION cause',
    actual: r.kind === 'failed' && [
      r.reason,
      r.code,
      r.cause instanceof Error && r.cause.message,
    ],
    expected: [
      'report_invalid',
      'VALIDATION',
      'Economics report input invalid',
    ],
  });
});

test('a snapshot observed in the future is named as such, not as a window mismatch', async () => {
  const r = await createBillingEconomicsCollector({
    sink: { open: async () => undefined },
    store: {
      read: async () => ({
        ...snapshot(),
        observedAt: '2026-12-01T00:00:00.000Z',
      }),
    },
    feed: { read: async () => feed() },
    now: () => now,
    save: async () => undefined,
  }).run(window);
  assert({
    given:
      'a snapshot whose window matches but whose observation is later than now',
    should: 'fail as snapshot_invalid with its own fixed message',
    actual: r.kind === 'failed' && isAppError(r.cause) && r.cause.message,
    expected: 'Economics snapshot observed in the future',
  });
});

test('a malformed window is refused before any I/O, as inputs_invalid', async () => {
  const touched: string[] = [];
  const r = await createBillingEconomicsCollector({
    sink: {
      open: async () => {
        touched.push('sink');
      },
    },
    store: {
      read: async () => {
        touched.push('store');
        return snapshot();
      },
    },
    feed: { read: async () => feed() },
    now: () => now,
    save: async () => undefined,
  }).run({ startsAt: 'not an instant', endsAt: 'neither' });
  assert({
    given: 'a collection asked for a window that is not two instants',
    should:
      'fail as inputs_invalid (INTERNAL) with its own reason, touching neither the sink nor the store',
    actual: [
      r.kind === 'failed' && [
        r.reason,
        r.code,
        isAppError(r.cause) && r.cause.reason,
      ],
      touched,
    ],
    expected: [['inputs_invalid', 'INTERNAL', 'economics-window-invalid'], []],
  });
});
