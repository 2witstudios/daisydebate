/** Deterministic current account/age projection shared by authorization tests. */
export const adultAccount = (actorId: string, userId = actorId) => ({
  account: { userId, actorId, member: true, erased: false, revision: 1 },
  age: {
    state: 'known' as const,
    actorId,
    band: 'adult' as const,
    revision: 1,
    accountRevision: 1,
    validUntil: '2026-11-01T00:00:00.000Z',
  },
});
