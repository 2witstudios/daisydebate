export const now = '2026-11-06T00:00:00.000Z';
export const month = '2026-10-01T00:00:00.000Z';
export const measured = (amountMicros: number) => ({
  kind: 'measured' as const,
  amountMicros,
});
export const dataset = () => ({
  startsAt: month,
  endsAt: '2026-11-01T00:00:00.000Z',
  floorBasisPoints: 3000,
  revenue: [
    {
      sequence: 1,
      plan: 'premium',
      sourceMonth: month,
      observedAt: now,
      kind: 'receipt',
      money: measured(10000000),
    },
  ],
  costs: [
    {
      sequence: 1,
      category: 'models',
      sourceMonth: month,
      observedAt: now,
      allocation: {
        rule: 'direct',
        shares: [{ plan: 'premium', basisPoints: 10000 }],
      },
      money: measured(7000001),
    },
  ],
  modelUsage: [],
  rates: [],
  coverage: ['premium'].flatMap((plan) =>
    [
      'models',
      'speech',
      'recording',
      'broadcast',
      'storage',
      'paymentFees',
      'shared',
      'freeTierSubsidy',
    ].map((category) => ({ plan, category, kind: 'measured' })),
  ),
  revenueCoverage: [{ plan: 'premium', kind: 'measured' }],
  volume: [
    {
      plan: 'premium' as const,
      feature: 'casual_ai_judge' as const,
      completed: 1000,
      possibleCalls: 1002,
      capacity: { kind: 'measured' as const, peak: 1, limit: 1 },
    },
  ],
});
