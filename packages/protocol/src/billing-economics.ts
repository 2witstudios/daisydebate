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
export type BillingEconomicsSnapshot = z.infer<
  typeof billingEconomicsSnapshotSchema
>;

export const billingEconomicsReadSchema = billingEconomicsSnapshotSchema.extend(
  { complete: z.boolean() },
);
