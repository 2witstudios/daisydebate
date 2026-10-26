import type { PresenceActivity } from '@daisy/protocol';

/** ADR 0033 §1: a 60 s lease, refreshed every 20 s while the socket lives. */
export const PRESENCE_TTL_SECONDS = 60;
export const PRESENCE_REFRESH_MS = 20_000;

type LeaseKey = { readonly connId: string; readonly actorId: string };
export type PresenceLeases = {
  readonly upsertPresenceLease: (
    lease: LeaseKey & {
      readonly instanceId: string;
      readonly activity: PresenceActivity;
    },
    ttlSeconds: number,
  ) => Promise<void>;
  readonly refreshPresenceLease: (
    lease: LeaseKey,
    ttlSeconds: number,
  ) => Promise<{ readonly refreshed: boolean }>;
  readonly deletePresenceLease: (lease: LeaseKey) => Promise<void>;
};
export type PresenceTimers = {
  readonly setInterval: (
    callback: () => void,
    ms: number,
  ) => ReturnType<typeof setInterval>;
  readonly clearInterval: (handle: ReturnType<typeof setInterval>) => void;
};

/** One authenticated socket's presence: report activity, then stop. */
export type PresenceSession = {
  readonly activity: (activity: PresenceActivity) => void;
  readonly stop: () => void;
};
export type PresenceTracker = {
  readonly start: (
    actorId: string,
    activity: PresenceActivity,
  ) => PresenceSession;
};

/**
 * Presence leases for authenticated sockets (ADR 0033 §1, ADR 0072). The
 * instance mints the connection id, which never leaves the server. Presence
 * is advisory: a Redis failure (logged by the Redis adapter as
 * `redis.command.failed`) never closes the socket or delays a frame, and a
 * crashed instance's leases simply expire.
 */
export function createPresenceTracker({
  leases,
  instanceId,
  nextId,
  timers,
}: {
  readonly leases: PresenceLeases;
  readonly instanceId: string;
  readonly nextId: () => string;
  readonly timers: PresenceTimers;
}): PresenceTracker {
  const ignore = () => {};
  return {
    start(actorId, activity) {
      const key = { connId: nextId(), actorId };
      let current = activity;
      let stopped = false;
      const upsert = () =>
        leases.upsertPresenceLease(
          { ...key, instanceId, activity: current },
          PRESENCE_TTL_SECONDS,
        );
      void upsert().catch(ignore);
      const refresh = timers.setInterval(() => {
        void leases
          .refreshPresenceLease(key, PRESENCE_TTL_SECONDS)
          .then(({ refreshed }) => {
            if (!refreshed && !stopped) return upsert();
          })
          .catch(ignore);
      }, PRESENCE_REFRESH_MS);
      return {
        activity(activity) {
          if (stopped || activity === current) return;
          current = activity;
          void upsert().catch(ignore);
        },
        stop() {
          if (stopped) return;
          stopped = true;
          timers.clearInterval(refresh);
          void leases.deletePresenceLease(key).catch(ignore);
        },
      };
    },
  };
}
