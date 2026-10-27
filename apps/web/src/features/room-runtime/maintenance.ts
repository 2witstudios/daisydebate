import type { Database } from '@daisy/db';
import { maintainRoom } from '@daisy/debate-engine';
import type { WorkerTimers } from '../../lib/worker-timers';

/** How often Room maintenance runs: due draw strikes settle within a pulse. */
const ROOM_MAINTENANCE_PULSE_MS = 500;

/**
 * Room lifecycle maintenance (ISSUE-771): settles due draw strikes and
 * closes open Rooms idle past the policy timeout, a page per pulse.
 * Settlement runs even with expiry unset (`idleTimeoutMs` null). A Room
 * that fails is reported after the page, so it never holds back the Rooms
 * after it.
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
  async (): Promise<void> => {
    const { idleTimeoutMs } = input;
    const roomIds = await input.store.readMaintenanceCandidates({
      idleTimeoutMs,
      limit: 64,
    });
    const failures: unknown[] = [];
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
        .catch((error: unknown) => failures.push(error));
    if (failures.length)
      throw new AggregateError(failures, 'Room maintenance failed');
  };

/**
 * Runs Room maintenance on its own timer, apart from Round maintenance: one
 * pass at a time, a failed pass reported and retried on the next pulse.
 */
export function startRoomMaintenance(input: {
  readonly maintainRooms: () => Promise<unknown>;
  readonly timers: WorkerTimers;
  readonly failed: (error: unknown) => void;
}) {
  let stopped = false,
    running = false;
  let work = Promise.resolve();
  const sweep = async () => {
    running = true;
    try {
      await input.maintainRooms();
    } catch (error) {
      input.failed(error);
    } finally {
      running = false;
    }
  };
  const pulse = () => {
    if (!stopped && !running) work = sweep();
    return work;
  };
  const timer = input.timers.setInterval(pulse, ROOM_MAINTENANCE_PULSE_MS);
  return {
    ready: pulse(),
    stop: () => {
      stopped = true;
      input.timers.clearInterval(timer);
      return work;
    },
  };
}
