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
const RETRY_CAP_MS = 60_000;

/**
 * How long heartbeats wait after `failures` consecutive unacknowledged
 * passes: the next heartbeat, then twice as long each time, up to a minute.
 * A reconnect, coming online or the tab showing again retries at once.
 */
export function attendanceRetryWaitMs(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(RETRY_CAP_MS, ATTENDANCE_HEARTBEAT_MS * 2 ** (failures - 1));
}

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
  let inFlight: Promise<void> | null = null;
  let forceQueued = false;
  let failures = 0;
  let retryAtMs = 0;
  const signOut = () => {
    if (stopped) return;
    stopped = true;
    active = false;
    pending.clear();
    deps.signedOut?.();
  };
  const send = async (force: boolean): Promise<void> => {
    if (!active) return;
    if (inFlight) {
      forceQueued ||= force;
      await inFlight;
      return;
    }
    inFlight = (async () => {
      let failed = false;
      for (const item of [...pending.values()].reverse()) {
        if (!active) break;
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
      failures = failed ? failures + 1 : 0;
      retryAtMs = nowMs() + attendanceRetryWaitMs(failures);
    })();
    try {
      await inFlight;
    } finally {
      inFlight = null;
      if (forceQueued) {
        forceQueued = false;
        await send(true);
      }
    }
  };
  const adopt = (snapshot: Snapshot) => {
    if (stopped || terminal) return;
    active = snapshot.status === 'active';
    if (!active) {
      terminal =
        snapshot.status === 'completed' || snapshot.status === 'abandoned';
      pending.clear();
      return;
    }
    for (const segment of snapshot.segments)
      if (
        segment.type === 'speech' &&
        !pending.has(segment.id) &&
        !retired.has(segment.id)
      )
        pending.set(segment.id, {
          segmentId: segment.id,
          commandId: deps.nextCommandId(),
          acknowledged: false,
        });
  };
  const refresh = async (force: boolean) => {
    if (stopped || terminal) return;
    // A heartbeat inside the back-off waits; a reconnect never does.
    if (!force && nowMs() < retryAtMs) return;
    const snapshot = await deps.read().catch(() => null);
    if (stopped || terminal) return;
    if (snapshot === 'signed-out') {
      signOut();
      return;
    }
    if (snapshot) adopt(snapshot);
    await send(force);
  };
  return {
    async update(snapshot: Snapshot) {
      adopt(snapshot);
      await send(false);
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
