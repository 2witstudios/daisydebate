import type { Database } from '@daisy/db';
import { maintainRoom } from '@daisy/debate-engine';
import type { WorkerTimers } from '../../lib/worker-timers';
import type { LoopPass } from '../../lib/idle-backoff';
import { LIVE_IDLE_MAX_MS, startWorkerLoop } from '../../lib/worker-loop';

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
      Database,
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
    for (const roomId of roomIds)
      await input.store
        .maintainRoom({
          roomId,
          maintain: (state, facts) =>
            maintainRoom(state, {
              lastCommandAt: facts.lastCommandAt,
              now: facts.now,
              idleTimeoutMs,
            }),
        })
        .catch((error: unknown) => failed(error, 'maintain'));
    return roomIds.length > 0 ? 'worked' : 'idle';
  };

/** Runs Room maintenance on its own worker loop, apart from Round maintenance. */
export function startRoomMaintenance(input: {
  readonly maintainRooms: (failed: RoomMaintenanceFailed) => Promise<LoopPass>;
  readonly timers: WorkerTimers;
  readonly failed: RoomMaintenanceFailed;
}) {
  return startWorkerLoop({
    run: () => input.maintainRooms(input.failed),
    // A Room idle past the timeout is found within the cap; one being
    // maintained keeps the pulse (ADR 0153).
    backoff: { busyMs: ROOM_MAINTENANCE_PULSE_MS, idleMaxMs: LIVE_IDLE_MAX_MS },
    timers: input.timers,
    failed: (error) => input.failed(error, 'discover'),
  });
}
