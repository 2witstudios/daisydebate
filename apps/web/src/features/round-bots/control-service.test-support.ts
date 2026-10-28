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

/** An ending deadline that never trips, for tests about other behavior. */
export const neverOverdue = () => new Promise<void>(() => {});

/** A seat target whose Round and seat share one id. */
export const seat = (id: string, segmentId = 's') => ({
  roundId: id,
  roundParticipantId: id,
  segmentId,
});

/** Each recorded failure as [message, stage]. */
export const failureStages = (failures: readonly unknown[]) =>
  failures.map((failure) => {
    const [error, stage] = failure as [Error, string];
    return [error.message, stage];
  });
