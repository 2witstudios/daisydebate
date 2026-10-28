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

/**
 * `promise`, or a failure naming what never happened when it does not
 * settle within `ms`, so a regression fails with a reason, not a timeout.
 */
export function within<T>(promise: Promise<T>, what: string, ms = 1_000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} never happened`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}
