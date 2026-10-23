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
  readonly read: () => Promise<Snapshot | null>;
  readonly nextCommandId: () => string;
  readonly send: (command: {
    readonly commandId: string;
    readonly segmentId: string;
  }) => Promise<boolean | 'closed'>;
}) {
  const pending = new Map<string, Pending>();
  const retired = new Set<string>();
  let active = true;
  let stopped = false;
  let terminal = false;
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
      for (const item of [...pending.values()].reverse()) {
        if (!active) break;
        if (item.acknowledged && !force) continue;
        try {
          const result = await deps.send({
            commandId: item.commandId,
            segmentId: item.segmentId,
          });
          if (result === 'closed') {
            pending.delete(item.segmentId);
            retired.add(item.segmentId);
          } else item.acknowledged = result;
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
    const snapshot = await deps.read().catch(() => null);
    if (stopped || terminal) return;
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
