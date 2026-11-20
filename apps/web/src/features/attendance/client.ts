import { nextWaitMs, type IdleBackoff } from '../../lib/idle-backoff';
type Snapshot = {
  readonly status: string;
  readonly segments: readonly { readonly id: string; readonly type: string }[];
};
type Pending = {
  readonly commandId: string;
  readonly segmentId: string;
  acknowledged: boolean;
};
/** The heartbeat's cadence; a failing check-in waits longer between retries. */
export const ATTENDANCE_HEARTBEAT_MS = 15_000;
/**
 * A failing check-in waits for the next heartbeat, then twice as long each
 * time, up to a minute: the shared worker back-off. A reconnect, coming
 * online or the tab showing again retries at once.
 */
export const ATTENDANCE_RETRY: IdleBackoff = {
  busyMs: ATTENDANCE_HEARTBEAT_MS,
  idleMaxMs: 60_000,
};
/**
 * Half a heartbeat of slack: a retry due at T is taken by any heartbeat from
 * T - 7.5 s, so neither a timer firing a few ms early nor a failure on a view
 * push between heartbeats makes the due heartbeat skip it. View pushes take
 * no slack, so view churn never retries early.
 */
const RETRY_SLACK_MS = ATTENDANCE_HEARTBEAT_MS / 2;

/**
 * An exact HTTP command survives an unknown acknowledgement. Socket state is
 * deliberately absent. A 401 means the session is gone: the client stops for
 * good and says so once, never retrying.
 */
export function createAttendanceClient(deps: {
  readonly read: () => Promise<Snapshot | null | 'signed-out'>;
  readonly nextCommandId: () => string;
  readonly send: (command: {
    readonly commandId: string;
    readonly segmentId: string;
  }) => Promise<boolean | 'closed' | 'signed-out'>;
  /** Monotonic milliseconds, for the retry back-off. */
  readonly nowMs: () => number;
  readonly signedOut?: () => void;
}) {
  const { nowMs } = deps;
  const pending = new Map<string, Pending>();
  const retired = new Set<string>();
  let active = true;
  let stopped = false;
  let terminal = false;
  /** Read afresh after every await: stop(), sign-out and a view flip these between them. */
  const isActive = () => active;
  const isHalted = () => stopped || terminal;
  let inFlight: Promise<void> | null = null;
  let forceQueued = false;
  /** The wait the last failing pass set, or null while check-ins succeed. */
  let retryWaitMs: number | null = null;
  let retryAtMs = 0;
  const signOut = () => {
    if (stopped) return;
    stopped = true;
    active = false;
    pending.clear();
    deps.signedOut?.();
  };
  /** `tickAt` is when the tick that asked began, before any read. */
  const send = async (force: boolean, tickAt: number): Promise<void> => {
    if (!active) return;
    if (inFlight) {
      forceQueued ||= force;
      await inFlight;
      return;
    }
    inFlight = (async () => {
      let failed = false;
      for (const item of [...pending.values()].reverse()) {
        if (!isActive()) break;
        if (item.acknowledged && !force) continue;
        try {
          const result = await deps.send({
            commandId: item.commandId,
            segmentId: item.segmentId,
          });
          if (result === 'signed-out') {
            signOut();
            return;
          }
          if (result === 'closed') {
            pending.delete(item.segmentId);
            retired.add(item.segmentId);
          } else item.acknowledged = result;
          failed ||= result === false;
        } catch {
          item.acknowledged = false;
          failed = true;
        }
      }
      retryWaitMs = failed
        ? nextWaitMs(ATTENDANCE_RETRY, retryWaitMs, 'failed')
        : null;
      // Measured from the tick's start, before its read, so no request's
      // latency can make the due heartbeat skip a retry.
      retryAtMs = tickAt + (retryWaitMs ?? 0);
    })();
    try {
      await inFlight;
    } finally {
      inFlight = null;
      if (forceQueued) {
        forceQueued = false;
        await send(true, nowMs());
      }
    }
  };
  /** Takes a snapshot's speeches; returns how many it had not seen before. */
  const adopt = (snapshot: Snapshot): number => {
    if (stopped || terminal) return 0;
    active = snapshot.status === 'active';
    if (!active) {
      terminal =
        snapshot.status === 'completed' || snapshot.status === 'abandoned';
      pending.clear();
      return 0;
    }
    let added = 0;
    for (const segment of snapshot.segments)
      if (
        segment.type === 'speech' &&
        !pending.has(segment.id) &&
        !retired.has(segment.id)
      ) {
        pending.set(segment.id, {
          segmentId: segment.id,
          commandId: deps.nextCommandId(),
          acknowledged: false,
        });
        added += 1;
      }
    return added;
  };
  /**
   * Whether a tick sends: a reconnect always; otherwise when a speech is new
   * or the back-off has run out. Failing check-ins wait, new ones never do.
   */
  const sends = (
    force: boolean,
    added: number,
    tickAt: number,
    slackMs: number,
  ) => force || added > 0 || tickAt >= retryAtMs - slackMs;
  const refresh = async (force: boolean) => {
    if (stopped || terminal) return;
    const tickAt = nowMs();
    const snapshot = await deps.read().catch(() => null);
    if (isHalted()) return;
    if (snapshot === 'signed-out') {
      signOut();
      return;
    }
    // Inside the back-off a heartbeat still reads, so a new speech is sent.
    const added = snapshot ? adopt(snapshot) : 0;
    // A heartbeat takes half a heartbeat of slack; a view push takes none.
    if (sends(force, added, tickAt, RETRY_SLACK_MS)) await send(force, tickAt);
  };
  return {
    /** A new view: the same back-off as a heartbeat, so view churn never retries. */
    async update(snapshot: Snapshot) {
      const tickAt = nowMs();
      const added = adopt(snapshot);
      if (sends(false, added, tickAt, 0)) await send(false, tickAt);
    },
    reconnect: () => refresh(true),
    heartbeat: () => refresh(false),
    stop() {
      stopped = true;
      active = false;
      pending.clear();
    },
  };
}
