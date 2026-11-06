import { z } from 'zod';

export const economicsPlans = ['free', 'beta', 'premium'] as const;
export const economicsCategories = [
  'models',
  'speech',
  'recording',
  'broadcast',
  'storage',
  'paymentFees',
  'shared',
  'freeTierSubsidy',
] as const;
export const economicsInstant = z.iso.datetime({ precision: 3 });
const integer = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const economicsMoney = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.enum(['measured', 'estimated']),
    amountMicros: z
      .number()
      .int()
      .min(-Number.MAX_SAFE_INTEGER)
      .max(Number.MAX_SAFE_INTEGER),
  }),
  z.strictObject({
    kind: z.literal('unknown'),
    reason: z.enum([
      'not_measured',
      'rate_missing',
      'allocation_missing',
      'outcome_unknown',
    ]),
  }),
]);
const plan = z.enum(economicsPlans);
const category = z.enum(economicsCategories);
const recognition = {
  sequence: integer,
  sourceMonth: economicsInstant,
  observedAt: economicsInstant,
};
export const economicsInput = z.strictObject({
  startsAt: economicsInstant,
  endsAt: economicsInstant,
  floorBasisPoints: z.number().int().min(0).max(10000).nullable(),
  revenue: z.array(
    z.strictObject({
      ...recognition,
      plan,
      kind: z.enum(['receipt', 'refund']),
      money: economicsMoney,
    }),
  ),
  costs: z.array(
    z.strictObject({
      ...recognition,
      category,
      money: economicsMoney,
      allocation: z.strictObject({
        rule: z.enum(['direct', 'usage_share', 'equal_share', 'free_subsidy']),
        shares: z
          .array(
            z.strictObject({
              plan,
              basisPoints: z.number().int().min(1).max(10000),
            }),
          )
          .min(1)
          .max(3),
      }),
    }),
  ),
  modelUsage: z.array(
    z.strictObject({
      sequence: integer,
      plan,
      evidence: z.enum(['provider_response', 'invoice_reconciled', 'unknown']),
      model: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_./:-]{0,127}$/),
      provider: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_./:-]{0,127}$/),
      occurredAt: economicsInstant,
      throughAt: economicsInstant,
      observedAt: economicsInstant,
      inputTokens: integer.nullable(),
      outputTokens: integer.nullable(),
    }),
  ),
  rates: z.array(
    z.strictObject({
      model: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_./:-]{0,127}$/),
      provider: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_./:-]{0,127}$/),
      effectiveFrom: economicsInstant,
      effectiveUntil: economicsInstant.nullable(),
      observedAt: economicsInstant,
      provenance: z.enum(['billed_rate', 'catalog_estimate']),
      inputMicrosPerMillion: integer,
      outputMicrosPerMillion: integer,
    }),
  ),
  coverage: z.array(
    z.strictObject({ plan, category, kind: z.enum(['measured', 'estimated']) }),
  ),
  revenueCoverage: z.array(
    z.strictObject({ plan, kind: z.enum(['measured', 'estimated']) }),
  ),
  volume: z.array(
    z.strictObject({
      plan,
      feature: z.enum([
        'ai_round',
        'casual_ai_judge',
        'round_analysis',
        'casual_capture',
        'recording_download',
      ]),
      completed: integer.nullable(),
      possibleCalls: integer.nullable(),
      capacity: z.discriminatedUnion('kind', [
        z.strictObject({
          kind: z.literal('measured'),
          peak: integer,
          limit: integer,
        }),
        z.strictObject({ kind: z.literal('unknown') }),
      ]),
    }),
  ),
});
export type EconomicsInput = z.infer<typeof economicsInput>;
export type EconomicsMoney = z.infer<typeof economicsMoney>;
export type EconomicsPlan = (typeof economicsPlans)[number];
