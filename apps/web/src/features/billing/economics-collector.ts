import { z } from 'zod';
import { billingEconomicsReadSchema } from '@daisy/protocol/billing-economics';
import type { ErrorReporter } from '@daisy/observability';
import {
  economicsInput,
  economicsPlans,
  type EconomicsInput,
  type EconomicsPlan,
} from './economics-input';
import { runEconomicsReport } from './economics-alert';
import type { buildEconomicsReport } from './economics-report';

const privateFeed = economicsInput
  .omit({ modelUsage: true, volume: true })
  .extend({
    modelCostBasis: z.enum(['provider_invoice', 'usage_counters']),
    volume: economicsInput.shape.volume.default([]),
  });
type Window = { readonly startsAt: string; readonly endsAt: string };
type Snapshot = z.infer<typeof billingEconomicsReadSchema>;
const planFor = (source: string): EconomicsPlan | null =>
  source === 'subscription'
    ? 'premium'
    : source === 'beta'
      ? 'beta'
      : source === 'lifetime' || source === 'ranked'
        ? 'free'
        : null;
function volumeFor(
  plan: EconomicsPlan,
  feature: EconomicsInput['volume'][number]['feature'],
  snapshot: Snapshot,
  measurements: EconomicsInput['volume'],
): EconomicsInput['volume'][number] {
  const measured = measurements.find(
    (v) => v.plan === plan && v.feature === feature,
  );
  const capacity = measured?.capacity ?? { kind: 'unknown' as const };
  if (feature === 'casual_capture' || feature === 'recording_download')
    return {
      plan,
      feature,
      completed: measured?.completed ?? null,
      possibleCalls: measured?.possibleCalls ?? null,
      capacity,
    };
  const delivered = snapshot.usage.filter(
    (u) =>
      planFor(u.sourceKind) === plan &&
      u.feature === feature &&
      (u.state === 'delivered' ||
        (u.state === 'credited' && u.providerOutcome === 'delivered')),
  );
  return {
    plan,
    feature,
    completed: delivered.reduce((n, u) => n + u.reservations, 0),
    possibleCalls: snapshot.attempts
      .filter((a) => planFor(a.sourceKind) === plan && a.feature === feature)
      .reduce((n, a) => n + a.runs, 0),
    capacity,
  };
}
function usageRows(
  snapshot: Snapshot,
  offset: number,
): EconomicsInput['modelUsage'] {
  return snapshot.attempts
    .filter((a) => a.feature !== 'speech')
    .flatMap((a, index) => {
      const plan = planFor(a.sourceKind);
      if (plan === null) return [];
      const common = {
        plan,
        model: a.model ?? 'unrecorded',
        provider: a.provider,
        occurredAt: a.firstAt,
        throughAt: a.lastAt,
        observedAt: snapshot.observedAt,
      };
      return [
        ...(a.knownResponses > 0
          ? [
              {
                ...common,
                sequence: offset + index * 2,
                evidence:
                  a.model === null || a.provider === 'unrecorded'
                    ? ('unknown' as const)
                    : ('provider_response' as const),
                inputTokens: a.inputTokens,
                outputTokens: a.outputTokens,
              },
            ]
          : []),
        ...(a.unknownCalls > 0
          ? [
              {
                ...common,
                sequence: offset + index * 2 + 1,
                evidence: 'unknown' as const,
                inputTokens: null,
                outputTokens: null,
              },
            ]
          : []),
      ];
    });
}
function dataset(window: Window, snapshot: Snapshot, value: unknown) {
  const feed =
    value === null
      ? {
          ...window,
          floorBasisPoints: 3000,
          revenue: [],
          costs: [],
          rates: [],
          coverage: [],
          revenueCoverage: [],
          modelCostBasis: 'usage_counters' as const,
          volume: [],
        }
      : privateFeed.parse(value);
  if (feed.startsAt !== window.startsAt || feed.endsAt !== window.endsAt)
    throw new Error('Economics feed window mismatch');
  if (
    new Set(feed.volume.map((v) => `${v.plan}:${v.feature}`)).size !==
    feed.volume.length
  )
    throw new Error('Duplicate capacity measurements');
  if (
    feed.modelCostBasis === 'usage_counters' &&
    feed.costs.some((c) => c.category === 'models')
  )
    throw new Error('Conflicting model cost bases');
  const unassigned = snapshot.attempts.some(
    (a) => planFor(a.sourceKind) === null,
  );
  const coverage = feed.coverage.filter(() => snapshot.complete && !unassigned);
  const rows = usageRows(
    snapshot,
    Math.max(-1, ...feed.costs.map((c) => c.sequence)) + 1,
  );
  const volume = economicsPlans.flatMap((plan) =>
    (
      [
        'ai_round',
        'casual_ai_judge',
        'round_analysis',
        'casual_capture',
        'recording_download',
      ] as const
    ).map((feature) => volumeFor(plan, feature, snapshot, feed.volume)),
  );
  return {
    ...window,
    floorBasisPoints: feed.floorBasisPoints,
    revenue: feed.revenue,
    costs: feed.costs,
    rates: feed.rates,
    revenueCoverage: feed.revenueCoverage,
    coverage,
    modelUsage: feed.modelCostBasis === 'provider_invoice' ? [] : rows,
    volume,
  };
}
/** Actual private source composition; neither an empty DB nor a missing supplier feed proves complete economics. */
export function createBillingEconomicsCollector(input: {
  readonly store: { readonly read: (window: Window) => Promise<unknown> };
  readonly feed: { readonly read: (window: Window) => Promise<unknown> };
  readonly save: (value: {
    readonly report: ReturnType<typeof buildEconomicsReport>;
    readonly snapshot: Snapshot | null;
  }) => Promise<void>;
  readonly reporter: ErrorReporter;
  readonly now: () => string;
}) {
  return {
    async run(window: Window) {
      let snapshot: Snapshot | null = null;
      return runEconomicsReport({
        reporter: input.reporter,
        now: input.now,
        read: async () => {
          snapshot = billingEconomicsReadSchema.parse(
            await input.store.read(window),
          );
          if (
            snapshot.startsAt !== window.startsAt ||
            snapshot.endsAt !== window.endsAt ||
            snapshot.observedAt > input.now()
          )
            throw new Error('Economics snapshot window mismatch');
          const value = await input.feed.read(window);
          return dataset(window, snapshot, value);
        },
        save: (report) => input.save({ report, snapshot }),
      });
    },
  };
}
