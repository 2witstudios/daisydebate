import type { Database } from '@daisy/db';
import { maintainRoom } from '@daisy/debate-engine';
import {
  startSingleFlightWorker,
  type WorkerTimers,
} from '../../lib/worker-timers';

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
  async (failed: RoomMaintenanceFailed): Promise<void> => {
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
              drawSeed: facts.drawSeed,
            }),
        })
        .catch((error: unknown) => failed(error, 'maintain'));
  };

/** Runs Room maintenance on its own single-flight timer, apart from Round maintenance. */
export function startRoomMaintenance(input: {
  readonly maintainRooms: (failed: RoomMaintenanceFailed) => Promise<void>;
  readonly timers: WorkerTimers;
  readonly failed: RoomMaintenanceFailed;
}) {
  return startSingleFlightWorker({
    run: () => input.maintainRooms(input.failed),
    everyMs: ROOM_MAINTENANCE_PULSE_MS,
    timers: input.timers,
    failed: (error) => input.failed(error, 'discover'),
  });
}
