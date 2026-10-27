/** Deterministic current account/age projection shared by authorization tests. */
export const adultAccount = (actorId: string, userId = actorId) => ({
  account: {
    userId,
    actorId,
    member: true,
    erased: false,
    revision: 1,
    beta: { state: 'approved' as const, revision: 1 }, ageBand: 'adult' as const,
  },
  age: {
    state: 'known' as const,
    actorId,
    band: 'adult' as const,
    revision: 1,
    accountRevision: 1,
    validUntil: '2026-11-01T00:00:00.000Z',
  },
});
