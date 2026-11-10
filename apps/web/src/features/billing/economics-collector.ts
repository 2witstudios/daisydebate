import { z } from 'zod';
import { createRefusal, type ErrorCode } from '@daisy/errors';
import { typedCodeOr } from './economics-cause';
import { billingEconomicsReadSchema } from '@daisy/protocol/billing-economics';
import {
  economicsInput,
  economicsPlans,
  type EconomicsInput,
  type EconomicsPlan,
} from './economics-input';
import { economicsSignals, type EconomicsSignal } from './economics-alert';
import {
  hasRecordedEconomicsFloor,
  recordedMarginFloorBasisPoints,
} from './economics-policy';
import { buildEconomicsReport, type EconomicsReport } from './economics-report';

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
                  a.model === null ||
                  a.provider === 'unrecorded' ||
                  a.unmeasuredResponses > 0
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
/** The strict feed schema; a refusal is the operator's data, never echoed into the message. */
function parseFeed(value: unknown) {
  const parsed = privateFeed.safeParse(value);
  if (!parsed.success)
    throw createRefusal(
      'VALIDATION',
      'economics-feed-schema-invalid',
      'Economics feed schema invalid',
      parsed.error,
    );
  return parsed.data;
}
function dataset(window: Window, snapshot: Snapshot, value: unknown) {
  const feed =
    value === null
      ? {
          ...window,
          floorBasisPoints: recordedMarginFloorBasisPoints,
          revenue: [],
          costs: [],
          rates: [],
          coverage: [],
          revenueCoverage: [],
          modelCostBasis: 'usage_counters' as const,
          volume: [],
        }
      : parseFeed(value);
  // Checked after the schema, so a malformed feed is named as malformed, not as a floor change.
  if (!hasRecordedEconomicsFloor(feed))
    throw createRefusal(
      'VALIDATION',
      'economics-feed-floor-changed',
      'Economics feed floor is not the recorded policy',
    );
  if (feed.startsAt !== window.startsAt || feed.endsAt !== window.endsAt)
    throw createRefusal(
      'VALIDATION',
      'economics-feed-window-mismatch',
      'Economics feed window mismatch',
    );
  if (
    new Set(feed.volume.map((v) => `${v.plan}:${v.feature}`)).size !==
    feed.volume.length
  )
    throw createRefusal(
      'VALIDATION',
      'economics-feed-duplicate-capacity',
      'Duplicate capacity measurements',
    );
  if (
    feed.modelCostBasis === 'usage_counters' &&
    feed.costs.some((c) => c.category === 'models')
  )
    throw createRefusal(
      'VALIDATION',
      'economics-feed-conflicting-basis',
      'Conflicting model cost bases',
    );
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
/** Why a month's collection did not save a report; each reason is one stage. */
export type EconomicsCollectionFailure =
  | 'sink_unavailable'
  | 'snapshot_failed'
  | 'snapshot_invalid'
  | 'feed_unreadable'
  | 'feed_invalid'
  | 'report_invalid'
  | 'report_failed'
  | 'save_failed';

/** The error code each failure is reported under: bad data is VALIDATION, an unavailable resource INFRASTRUCTURE. */
export const economicsFailureCode: Readonly<
  Record<EconomicsCollectionFailure, ErrorCode>
> = {
  sink_unavailable: 'INFRASTRUCTURE',
  snapshot_failed: 'INFRASTRUCTURE',
  snapshot_invalid: 'VALIDATION',
  feed_unreadable: 'INFRASTRUCTURE',
  feed_invalid: 'VALIDATION',
  report_invalid: 'VALIDATION',
  report_failed: 'INTERNAL',
  save_failed: 'INFRASTRUCTURE',
};

/**
 * One collection of a month: a saved report with the signals it implies and
 * whether the private feed was supplied, or the one stage that failed with the
 * error it caught. A missing feed is a known incomplete input, not a failure.
 */
export type EconomicsCollection =
  | {
      readonly kind: 'reported';
      readonly month: string;
      readonly feed: 'supplied' | 'missing';
      readonly report: EconomicsReport;
      readonly signals: readonly EconomicsSignal[];
    }
  | {
      readonly kind: 'failed';
      readonly month: string;
      readonly reason: EconomicsCollectionFailure;
      /** The code it is reported and remembered under: a typed cause's own, else its stage's. */
      readonly code: ErrorCode;
      readonly cause: unknown;
    };

/** A typed VALIDATION refusal is the operator's feed being wrong; anything else is the given stage's. */
const feedFault = (
  cause: unknown,
  otherwise: EconomicsCollectionFailure,
): EconomicsCollectionFailure =>
  typedCodeOr(cause, 'INTERNAL') === 'VALIDATION' ? 'feed_invalid' : otherwise;

type Stage<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly cause: unknown };
async function stage<T>(run: () => Promise<T> | T): Promise<Stage<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (cause) {
    return { ok: false, cause };
  }
}

/** Actual private source composition; neither an empty DB nor a missing supplier feed proves complete economics. The private report is saved before any signal can be raised from it. */
export function createBillingEconomicsCollector(input: {
  readonly sink: { readonly open: (window: Window) => Promise<void> };
  readonly store: { readonly read: (window: Window) => Promise<unknown> };
  readonly feed: { readonly read: (window: Window) => Promise<unknown> };
  readonly save: (value: {
    readonly report: EconomicsReport;
    readonly snapshot: Snapshot;
  }) => Promise<void>;
  readonly now: () => string;
}) {
  return {
    async run(window: Window): Promise<EconomicsCollection> {
      const month = window.startsAt.slice(0, 7);
      const failed = (reason: EconomicsCollectionFailure, cause: unknown) =>
        ({
          kind: 'failed',
          month,
          reason,
          code: typedCodeOr(cause, economicsFailureCode[reason]),
          cause,
        }) as const;
      const sink = await stage(() => input.sink.open(window));
      // An INTERNAL defect met while opening the sink (a malformed window, an invalid clock)
      // is the caller's defect, never the volume's.
      if (!sink.ok)
        return failed(
          typedCodeOr(sink.cause, 'INFRASTRUCTURE') === 'INTERNAL'
            ? 'report_failed'
            : 'sink_unavailable',
          sink.cause,
        );
      const read = await stage(() => input.store.read(window));
      if (!read.ok) return failed('snapshot_failed', read.cause);
      const snapshot = await stage(() => {
        const parsed = billingEconomicsReadSchema.parse(read.value);
        if (
          parsed.startsAt !== window.startsAt ||
          parsed.endsAt !== window.endsAt
        )
          throw createRefusal(
            'VALIDATION',
            'economics-snapshot-window-mismatch',
            'Economics snapshot window mismatch',
          );
        if (parsed.observedAt > input.now())
          throw createRefusal(
            'VALIDATION',
            'economics-snapshot-from-future',
            'Economics snapshot observed in the future',
          );
        return parsed;
      });
      if (!snapshot.ok) return failed('snapshot_invalid', snapshot.cause);
      const feed = await stage(() => input.feed.read(window));
      // The files edge marks a malformed feed's contents VALIDATION; anything else is the read failing.
      if (!feed.ok)
        return failed(feedFault(feed.cause, 'feed_unreadable'), feed.cause);
      const joined = await stage(() =>
        dataset(window, snapshot.value, feed.value),
      );
      // Only the join's own typed refusals are the feed's fault; anything else it throws is a defect.
      if (!joined.ok)
        return failed(feedFault(joined.cause, 'report_failed'), joined.cause);
      // The builder returns invalid input as a value; a throw from it is a defect, not bad data.
      const report = await stage(() =>
        buildEconomicsReport(joined.value, input.now()),
      );
      if (!report.ok) return failed('report_failed', report.cause);
      // The joined feed and snapshot fail the report's own schema or coherence: nothing worth keeping.
      if (report.value.kind === 'invalid')
        return failed(
          'report_invalid',
          createRefusal(
            'VALIDATION',
            'economics-report-input-invalid',
            'Economics report input invalid',
          ),
        );
      const accepted = report.value;
      const saved = await stage(() =>
        input.save({ report: accepted, snapshot: snapshot.value }),
      );
      if (!saved.ok) return failed('save_failed', saved.cause);
      return {
        kind: 'reported',
        month,
        feed: feed.value === null ? 'missing' : 'supplied',
        report: accepted,
        signals: economicsSignals(accepted),
      };
    },
  };
}
