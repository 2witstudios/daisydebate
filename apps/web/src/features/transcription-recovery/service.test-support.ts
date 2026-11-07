export const claim = () => ({
  kind: 'claimed' as const,
  roundId: 'round-memory',
  contextId: 'context-memory',
  claim: { workerId: 'worker-memory', epoch: 1, token: 'memory-only' },
  expiresAt: '2026-11-08T00:00:00.000Z',
  evidenceIds: ['original-memory'],
  model: 'controlled-model',
  policyDigest: 'a'.repeat(64),
});
export const limits = {
  parallel: 1,
  claimBatch: 2,
  scanMs: 1000,
  enrollMs: 2000,
  renewMs: 3000,
};
