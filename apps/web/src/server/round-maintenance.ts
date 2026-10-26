import type { ErrorReporter } from '@daisy/observability';
import { workerFailures } from './recoverable-failure';
import type { App } from './app';
import { createAttendanceFeature } from '../features/attendance/operations';
import {
  createRoundMaintenanceOperations,
  ROUND_START_HORIZON_MS,
} from '../features/round-finalization/maintenance';
import { startRoundMaintenance } from '../features/round-finalization/service';
import { readPublicCheckInProbe } from '../features/availability/configuration';
/** The existing availability lease supplies service authority; no new lease/pool is created. */
export function startRoundCompetitiveMaintenance(input: {
  readonly app: App;
  readonly instanceId: string;
  readonly timers: Parameters<typeof startRoundMaintenance>[0]['timers'];
  /** Scrubbed raw-error destination (ADR 0037); inert until configured. */
  readonly reporter?: ErrorReporter;
}) {
  const { app, instanceId } = input;
  const attendance = createAttendanceFeature({
    checkIns: app.database,
    evaluate: app.database.evaluateRoundAttendance,
    nextId: () => app.ids.next(),
    instanceId,
  });
  return startRoundMaintenance({
    ...createRoundMaintenanceOperations({
      store: app.database,
      instanceId,
      ids: app.ids,
      evaluate: attendance.evaluate,
      startHorizonMs: ROUND_START_HORIZON_MS,
      idleTimeoutMs: app.roomPolicy?.idleTimeoutMs ?? null,
      probeRoundId:
        readPublicCheckInProbe(app.config.ATTENDANCE_PUBLIC_PROBE)?.roundId ??
        null,
    }),
    timers: input.timers,
    failed: workerFailures(app, input.reporter)(
      'round.maintenance.failed',
      'round.maintenance',
      'Competitive maintenance remains recoverable',
    ),
  });
}
