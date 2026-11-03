/** Past this with no control plane, nothing can revoke the observer (ADR 0099). */
const HEARTBEAT_STALE_MS = 10_000;
const CHECK_EVERY_MS = 2000;

/**
 * Stops the Egress of any Broadcast whose control plane has gone quiet: with the
 * web tier down nothing revokes the observer and grants stop changing, so the stage
 * must not keep recording. It runs apart from the release slots, so a busy slot
 * cannot delay it. It acts only on a read that followed a good read: after an outage
 * its own, every heartbeat looks stale until the web has had a moment to write, and
 * a failed read stops nothing. One Egress failing reaches no other. A control plane
 * that returns finds no Egress recorded and takes the normal path.
 */
export const runDeadManSwitch = async (deps: {
  readonly store: {
    readonly listHeartbeatLapsed: (input: {
      readonly staleMs: number;
    }) => Promise<
      readonly { readonly id: string; readonly egressId: string | null }[]
    >;
    readonly recordHeartbeatStop: (input: {
      readonly id: string;
      readonly egressId: string;
    }) => Promise<unknown>;
  };
  readonly stopEgress: (egressId: string) => Promise<void>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly stopped: () => boolean;
  readonly report: (
    event: 'broadcast.dead_man_stopped' | 'broadcast.dead_man_failed',
  ) => void;
}) => {
  let lastReadGood = false;
  while (!deps.stopped()) {
    try {
      const lapsed = await deps.store.listHeartbeatLapsed({
        staleMs: HEARTBEAT_STALE_MS,
      });
      if (lastReadGood)
        for (const { id, egressId } of lapsed)
          if (egressId !== null)
            try {
              await deps.stopEgress(egressId);
              await deps.store.recordHeartbeatStop({ id, egressId });
              deps.report('broadcast.dead_man_stopped');
            } catch {
              deps.report('broadcast.dead_man_failed');
            }
      lastReadGood = true;
    } catch {
      lastReadGood = false;
      deps.report('broadcast.dead_man_failed');
    }
    await deps.sleep(CHECK_EVERY_MS);
  }
};
