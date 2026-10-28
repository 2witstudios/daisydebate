/** A claim the store hands back for a target, as the control service owns it. */
export const ownedClaim = (target: {
  readonly roundId: string;
  readonly roundParticipantId: string;
  readonly segmentId: string;
}) => ({
  scope: {
    ...target,
    agentRunId: 'run',
    serviceId: 'agent-run:run',
    publicationEpoch: 1,
  },
  token: 'memory-only',
  leaseExpiresAt: '2026-10-22T00:00:30Z',
});

/** Runs every queued microtask, so endings the fakes let finish have settled. */
export const settled = () =>
  new Promise<void>((resolve) => setImmediate(resolve));
