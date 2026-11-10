import { createOpenRouter } from '@daisy/ai-voice';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { billingEconomicsReadSchema } from '@daisy/protocol/billing-economics';
import { createBillingEconomicsCollector } from './economics-collector';
import { dataset, month, now } from './economics.test-support';
setupRitewayBun();
const window = { startsAt: month, endsAt: '2026-11-01T00:00:00.000Z' };
const attempt = (
  inputTokens: number,
  outputTokens: number,
  unmeasuredResponses: number,
  runs = 1,
) => ({
  sourceKind: 'subscription',
  sourceStartsAt: month,
  sourceEndsAt: window.endsAt,
  feature: 'ai_round',
  model: 'recorded-model',
  provider: 'openrouter',
  firstAt: month,
  lastAt: month,
  runs,
  knownResponses: runs,
  unmeasuredResponses,
  unknownCalls: 0,
  definiteFailures: 0,
  inputTokens,
  outputTokens,
  characters: 0,
});
const snapshot = (row: ReturnType<typeof attempt>) => ({
  ...window,
  observedAt: now,
  complete: true,
  attempts: [row],
  usage: [],
});
const feed = (basis: 'usage_counters' | 'provider_invoice') => {
  const { modelUsage: _m, volume: _v, ...data } = dataset();
  void _m;
  void _v;
  return {
    ...data,
    modelCostBasis: basis,
    costs: basis === 'provider_invoice' ? data.costs : [],
    rates: [
      {
        model: 'recorded-model',
        provider: 'openrouter',
        effectiveFrom: month,
        effectiveUntil: null,
        observedAt: now,
        provenance: 'billed_rate' as const,
        inputMicrosPerMillion: 2000000,
        outputMicrosPerMillion: 10000000,
      },
    ],
  };
};
async function collect(
  row: ReturnType<typeof attempt>,
  basis: 'usage_counters' | 'provider_invoice' = 'usage_counters',
) {
  const stored: unknown[] = [];
  const result = await createBillingEconomicsCollector({
    sink: { open: async () => undefined },
    store: { read: async () => snapshot(row) },
    feed: { read: async () => feed(basis) },
    now: () => now,
    save: async (value) => {
      stored.push(value);
    },
  }).run(window);
  return {
    kind: result.kind,
    margin:
      result.kind === 'reported' && result.report.kind === 'report'
        ? result.report.plans.premium.margin.kind
        : null,
    rows:
      result.kind === 'reported' && result.report.kind === 'report'
        ? result.report.sources.modelUsage
        : null,
    stored,
  };
}
test('actual optional provider usage is indistinguishable from explicit zero after adapter normalization', async () => {
  const rows = [];
  for (const usage of [undefined, { prompt_tokens: 0, completion_tokens: 0 }]) {
    const provider = createOpenRouter({
      apiKey: 'test-placeholder',
      fetch: async () =>
        Response.json({
          choices: [
            {
              message: { content: 'answer', refusal: null },
              finish_reason: 'stop',
            },
          ],
          ...(usage ? { usage } : {}),
        }),
    });
    const response = await provider.complete({
      model: 'recorded-model',
      messages: [],
      maxTokens: 10,
    });
    const row = attempt(response.promptTokens, response.completionTokens, 1);
    const result = await collect(row);
    rows.push([
      response.text,
      row.knownResponses,
      row.unknownCalls,
      result.kind,
      result.margin,
    ]);
  }
  assert({
    given:
      'genuine adapter normalization of a received answer with absent usage or explicit zero usage, with no durable usage-presence marker',
    should:
      'retain served responses and zero counters but refuse measured-zero token pricing',
    actual: rows,
    expected: [
      ['answer', 1, 0, 'reported', 'unknown'],
      ['answer', 1, 0, 'reported', 'unknown'],
    ],
  });
});
test('one unmeasured received response remains visible inside a positive aggregate', async () => {
  const row = attempt(1000, 200, 1, 2);
  const r = await collect(row);
  assert({
    given:
      'two successful responses with positive recorded counters and one indistinguishable zero/default response',
    should:
      'preserve positive counters and known response count while keeping the full aggregate cost unknown',
    actual: [
      r.kind,
      r.margin,
      r.rows?.map((x) => [x.inputTokens, x.outputTokens, x.evidence]),
      r.stored.map(
        (v) => (v as { snapshot: { attempts: unknown[] } }).snapshot.attempts,
      ),
    ],
    expected: ['reported', 'unknown', [[1000, 200, 'unknown']], [[row]]],
  });
});
test('known positive counter pairs still price while original invoice accounting remains separate', async () => {
  const positive = await collect(attempt(1000, 0, 0));
  const invoice = await collect(attempt(0, 0, 1), 'provider_invoice');
  assert({
    given:
      'a known positive pair with a legitimate zero counterpart, or separately reconciled provider invoice costs despite unmeasured response counters',
    should:
      'conserve known positive usage and keep invoice money independent from token knowledge',
    actual: [
      positive.margin,
      positive.rows?.map((x) => [x.inputTokens, x.outputTokens, x.evidence]),
      invoice.margin,
    ],
    expected: ['healthy', [[1000, 0, 'provider_response']], 'below_floor'],
  });
});
test('strict snapshots reject missing or inconsistent response-counter knowledge', () => {
  const valid = snapshot(attempt(0, 0, 1));
  const { unmeasuredResponses: _ignored, ...missing } = valid.attempts[0]!;
  void _ignored;
  const variants = [
    { ...valid, attempts: [missing] },
    snapshot(attempt(0, 0, 0)),
    snapshot(attempt(100, 20, 2)),
  ];
  assert({
    given: 'an old shape or fabricated complete counter knowledge',
    should: 'refuse rather than default unknown usage to measured zero',
    actual: variants.map(
      (x) => billingEconomicsReadSchema.safeParse(x).success,
    ),
    expected: [false, false, false],
  });
});

test('standalone provider-response pricing cannot promote a zero pair into measured usage', async () => {
  const { priceModelUsage } = await import('./economics-cost');
  const rate = feed('usage_counters').rates;
  const usage = {
    sequence: 1,
    plan: 'premium' as const,
    evidence: 'provider_response' as const,
    model: 'recorded-model',
    provider: 'openrouter',
    occurredAt: month,
    throughAt: month,
    observedAt: now,
    inputTokens: 0,
    outputTokens: 0,
  };
  assert({
    given: 'a received response alone at the pure pricing boundary',
    should:
      'preserve missing token knowledge even outside aggregate collection',
    actual: priceModelUsage(usage, rate).kind,
    expected: 'unknown',
  });
});
