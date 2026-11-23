import { type RoomStore } from '@daisy/db/stores/rooms';
import type { Waits } from '@daisy/clock';
import { pollWork, type LoopPass } from '@daisy/worker';
import { LIVE_IDLE_MAX_MS } from '../../lib/worker-idle';
import { maintainRoom } from '@daisy/debate-engine';

/** How often Room maintenance runs: due draw strikes settle within a pulse. */
const ROOM_MAINTENANCE_PULSE_MS = 500;

/** Where a Room maintenance failure happened: reading the page, or one Room. */
type RoomMaintenanceFailed = (
  error: unknown,
  stage: 'discover' | 'maintain',
) => void;

/**
 * Room lifecycle maintenance (ISSUE-771): settles due draw strikes and
 * closes open Rooms idle past the policy timeout, a page per pulse.
 * Settlement runs even with expiry unset (`idleTimeoutMs` null). Each Room
 * that fails is reported on its own, with its own error, and never holds
 * back the Rooms after it.
 */
export const createRoomMaintenance =
  (input: {
    readonly store: Pick<
      RoomStore,
      'readMaintenanceCandidates' | 'maintainRoom'
    >;
    /** Injected Room policy, or null to leave idle Room expiry inert (ADR 0070). */
    readonly idleTimeoutMs: number | null;
  }) =>
  async (failed: RoomMaintenanceFailed): Promise<LoopPass> => {
    const { idleTimeoutMs } = input;
    const roomIds = await input.store.readMaintenanceCandidates({
      idleTimeoutMs,
      limit: 64,
    });
    let changed = 0;
    for (const roomId of roomIds) {
      const maintained = await input.store
        .maintainRoom({
          roomId,
          maintain: (state, facts) =>
            maintainRoom(state, {
              lastCommandAt: facts.lastCommandAt,
              now: facts.now,
              idleTimeoutMs,
            }),
        })
        .catch((error: unknown) => {
          failed(error, 'maintain');
          return false;
        });
      if (maintained) changed += 1;
    }
    // Only a Room changed is work: a candidate the engine declines (its
    // Round still running) or another writer holds comes back every pass.
    return changed > 0 ? 'worked' : 'idle';
  };

/** Runs Room maintenance on its own worker loop, apart from Round maintenance. */
export function startRoomMaintenance(input: {
  readonly maintainRooms: (failed: RoomMaintenanceFailed) => Promise<LoopPass>;
  readonly waits: Waits;
  readonly failed: RoomMaintenanceFailed;
}) {
  return pollWork({
    pass: () => input.maintainRooms(input.failed),
    // A Room idle past the timeout is found within the cap; one being
    // maintained keeps the pulse (ADR 0154).
    backoff: { busyMs: ROOM_MAINTENANCE_PULSE_MS, idleMaxMs: LIVE_IDLE_MAX_MS },
    waits: input.waits,
    failed: (error) => input.failed(error, 'discover'),
  });
}
