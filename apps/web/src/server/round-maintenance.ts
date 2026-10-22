import { noopErrorReporter, type ErrorReporter } from '@daisy/observability';
import { recoverableFailure } from './recoverable-failure';
import type { App } from './app';
import { createAttendanceFeature } from '../features/attendance/operations';
import { createRoundMaintenanceOperations } from '../features/round-finalization/maintenance';
import { startRoundMaintenance } from '../features/round-finalization/service';
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
    }),
    timers: input.timers,
    failed: recoverableFailure({
      logger: app.logger,
      reporter: input.reporter ?? noopErrorReporter,
      nextId: () => app.ids.next(),
      event: 'round.maintenance.failed',
      operation: 'round.maintenance',
      message: 'Competitive maintenance remains recoverable',
    }),
  });
}
