import { z } from 'zod';
const instant = z.iso.datetime({ precision: 3 });
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const sourceKind = z.enum([
  'lifetime',
  'beta',
  'subscription',
  'ranked',
  'unattributed',
]);
const attribution = {
  sourceKind,
  sourceStartsAt: instant.nullable(),
  sourceEndsAt: instant.nullable(),
};
export const billingEconomicsSnapshotSchema = z.strictObject({
  startsAt: instant,
  endsAt: instant,
  observedAt: instant,
  attempts: z
    .array(
      z
        .strictObject({
          ...attribution,
          feature: z.enum([
            'ai_round',
            'casual_ai_judge',
            'round_analysis',
            'speech',
          ]),
          model: z.string().nullable(),
          provider: z.string(),
          firstAt: instant,
          lastAt: instant,
          runs: count,
          knownResponses: count,
          /** Received response with a zero token pair; existing storage cannot prove usage presence. */
          unmeasuredResponses: count,
          unknownCalls: count,
          definiteFailures: count,
          inputTokens: count,
          outputTokens: count,
          characters: count,
        })
        .refine(
          (row) =>
            row.unmeasuredResponses <= row.knownResponses &&
            (row.inputTokens !== 0 || row.outputTokens !== 0
              ? row.unmeasuredResponses < row.knownResponses ||
                row.knownResponses === 0
              : row.unmeasuredResponses === row.knownResponses),
          { message: 'Response counter knowledge is inconsistent' },
        ),
    )
    .max(1001),
  usage: z
    .array(
      z.strictObject({
        ...attribution,
        feature: z.enum(['ai_round', 'casual_ai_judge', 'round_analysis']),
        state: z.string(),
        providerOutcome: z
          .enum(['dispatched', 'unknown', 'delivered', 'definite_failure'])
          .nullable(),
        countBasis: z.string().nullable(),
        reservations: count,
      }),
    )
    .max(1001),
});

export const billingEconomicsReadSchema = billingEconomicsSnapshotSchema.extend(
  { complete: z.boolean() },
);

/**
 * The private billing economics worker's refusal words (ADR 0102): which fixed
 * check or stage failed. Code dedups failures and names them on the log line
 * by these words, never by a message. Internal; never sent to a client.
 */
export type BillingEconomicsRefusal =
  // The private file edge.
  | 'economics-clock-invalid'
  | 'economics-window-invalid'
  | 'economics-sink-not-private'
  | 'economics-sink-full'
  | 'economics-sink-unreadable'
  | 'economics-feed-unavailable'
  | 'economics-feed-not-private'
  | 'economics-feed-too-large'
  | 'economics-feed-unparseable'
  | 'economics-report-identity-invalid'
  // The collector's data checks.
  | 'economics-feed-schema-invalid'
  | 'economics-feed-floor-changed'
  | 'economics-feed-window-mismatch'
  | 'economics-feed-duplicate-capacity'
  | 'economics-feed-conflicting-basis'
  | 'economics-snapshot-window-mismatch'
  | 'economics-snapshot-from-future'
  | 'economics-report-input-invalid'
  // The worker's stages, carried by the error it reports.
  | 'economics-sink-unavailable'
  | 'economics-snapshot-failed'
  | 'economics-snapshot-invalid'
  | 'economics-feed-unreadable'
  | 'economics-feed-invalid'
  | 'economics-report-invalid'
  | 'economics-report-failed'
  | 'economics-save-failed'
  | 'economics-signal-failed'
  | 'economics-collect-failed';
