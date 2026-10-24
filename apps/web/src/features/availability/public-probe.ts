import { attendanceReceiptSchema, idSchema } from '@daisy/protocol';
export type PublicCheckInProbeConfiguration = {
  readonly origin: string;
  readonly roundId: string;
  readonly segmentId: string;
  readonly participantId: string;
  readonly cookie: string;
};
/**
 * How often the probe reads its own session through the public get-session
 * route. Check-in reads the session without refreshing it, so without this
 * the probe member's session would expire SESSION_EXPIRES_IN_SECONDS after it
 * was created and availability would go unhealthy (ISSUE-531). Better Auth
 * slides a session read this way once it is older than its update age.
 */
export const PROBE_SESSION_REFRESH_MS = 60 * 60_000;
/** Credentials enter only from the process edge; missing configuration remains unhealthy. */
export function createPublicCheckInProbe(input: {
  readonly configuration: PublicCheckInProbeConfiguration | null;
  readonly nextId: () => string;
  /** Monotonic milliseconds, for the session refresh cadence. */
  readonly nowMs: () => number;
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
}): () => Promise<boolean> {
  const config = input.configuration;
  if (!config) return async () => false;
  const origin = new URL(config.origin);
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    !config.cookie ||
    ![config.roundId, config.segmentId, config.participantId].every(
      (id) => idSchema.safeParse(id).success,
    )
  )
    throw new Error('Invalid public check-in probe configuration');
  let refreshedAtMs: number | null = null;
  // Its outcome never decides health: only the check-in receipt does.
  const slideSession = async () => {
    const now = input.nowMs();
    if (
      refreshedAtMs !== null &&
      now - refreshedAtMs < PROBE_SESSION_REFRESH_MS
    )
      return;
    refreshedAtMs = now;
    try {
      const response = await input.fetch(
        `${origin.origin}/api/auth/get-session`,
        {
          method: 'GET',
          redirect: 'error',
          signal: AbortSignal.timeout(900),
          headers: { cookie: config.cookie },
        },
      );
      // Only the server-side slide matters; the session body is discarded.
      await response.body?.cancel();
    } catch {
      // The next interval reads it again.
    }
  };
  return async () => {
    // Not awaited: the session read never delays this second's sample.
    void slideSession();
    const commandId = input.nextId();
    try {
      const response = await input.fetch(
        `${origin.origin}/api/rounds/${config.roundId}/check-in`,
        {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(900),
          headers: {
            'content-type': 'application/json',
            origin: origin.origin,
            cookie: config.cookie,
          },
          body: JSON.stringify({
            version: 1,
            commandId,
            segmentId: config.segmentId,
          }),
        },
      );
      if (!response.ok) return false;
      const parsed = attendanceReceiptSchema.safeParse(await response.json());
      return (
        parsed.success &&
        parsed.data.commandId === commandId &&
        parsed.data.roundId === config.roundId &&
        parsed.data.segmentId === config.segmentId &&
        parsed.data.participantId === config.participantId
      );
    } catch {
      return false;
    }
  };
}
