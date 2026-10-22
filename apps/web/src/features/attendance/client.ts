type Snapshot = {
  readonly status: string;
  readonly segments: readonly { readonly id: string; readonly type: string }[];
};
type Pending = {
  readonly commandId: string;
  readonly segmentId: string;
  acknowledged: boolean;
};
/** An exact HTTP command survives an unknown acknowledgement. Socket state is deliberately absent. */
export function createAttendanceClient(deps: {
  readonly nextCommandId: () => string;
  readonly send: (command: {
    readonly commandId: string;
    readonly segmentId: string;
  }) => Promise<boolean>;
}) {
  const pending = new Map<string, Pending>();
  let active = true;
  let inFlight: Promise<void> | null = null;
  let forceQueued = false;
  const send = async (force: boolean): Promise<void> => {
    if (!active) return;
    if (inFlight) {
      forceQueued ||= force;
      await inFlight;
      return;
    }
    inFlight = (async () => {
      for (const item of pending.values()) {
        if (!active) break;
        if (item.acknowledged && !force) continue;
        try {
          item.acknowledged = await deps.send({
            commandId: item.commandId,
            segmentId: item.segmentId,
          });
        } catch {
          item.acknowledged = false;
        }
      }
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
  return {
    async update(snapshot: Snapshot) {
      active = snapshot.status === 'active';
      if (!active) {
        pending.clear();
        return;
      }
      for (const segment of snapshot.segments)
        if (segment.type === 'speech' && !pending.has(segment.id))
          pending.set(segment.id, {
            segmentId: segment.id,
            commandId: deps.nextCommandId(),
            acknowledged: false,
          });
      await send(false);
    },
    reconnect: () => send(true),
    heartbeat: () => send(false),
    stop() {
      active = false;
      pending.clear();
    },
  };
}
