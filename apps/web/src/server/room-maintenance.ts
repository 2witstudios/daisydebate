import type { Waits } from '@daisy/clock';
import type { ErrorReporter } from '@daisy/observability';
import { workerFailures } from './recoverable-failure';
import type { App } from './app';
import {
  createRoomMaintenance,
  startRoomMaintenance,
} from '../features/room-runtime/maintenance';

/** Room lifecycle maintenance on its own timer and failure event (ISSUE-771). */
export function startRoomLifecycleMaintenance(input: {
  readonly app: App;
  readonly waits: Waits;
  /** Scrubbed raw-error destination (ADR 0037); inert until configured. */
  readonly reporter?: ErrorReporter;
}) {
  const { app } = input;
  const failed = workerFailures(app, input.reporter)(
    'room.maintenance.failed',
    'room.maintenance',
    'Room maintenance remains recoverable',
  );
  return startRoomMaintenance({
    maintainRooms: createRoomMaintenance({
      store: app.database,
      idleTimeoutMs: app.roomPolicy?.idleTimeoutMs ?? null,
    }),
    waits: input.waits,
    failed,
  });
}
