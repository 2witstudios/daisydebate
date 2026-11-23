import { defineComposition } from '../../server/composition';
import { runningWorkers } from './alert-state';
import { createAlertsHandler } from './alerts';
import { createMetricsHandler } from './metrics';
import { createReadinessHandler } from './readiness';

type OpsInputs = Omit<
  Parameters<typeof createReadinessHandler>[0],
  'startupChecked'
> &
  Pick<
    Parameters<typeof createAlertsHandler>[0],
    'clock' | 'local' | 'token' | 'waits'
  > &
  Pick<Parameters<typeof createMetricsHandler>[0], 'metrics'> & {
    readonly redis: Parameters<typeof createReadinessHandler>[0]['redis'] &
      Parameters<typeof createAlertsHandler>[0]['redis'];
    readonly startupChecked: () => boolean;
    readonly fileMaintenanceIntervalMs: number | null;
  };

/** Ops owns its health and probe bindings; request-time state stays lazy. */
export function composeOpsRoutes(app: OpsInputs) {
  return {
    ready: {
      GET: createReadinessHandler({
        database: app.database,
        redis: app.redis,
        isDraining: app.isDraining,
        startupChecked: app.startupChecked,
        logger: app.logger,
        reporter: app.reporter,
        waits: app.waits,
      }),
    },
    ops: {
      alerts: {
        GET: createAlertsHandler({
          logger: app.logger,
          reporter: app.reporter,
          redis: app.redis,
          local: app.local,
          clock: app.clock,
          waits: app.waits,
          workers: runningWorkers({
            fileMaintenanceIntervalMs: app.fileMaintenanceIntervalMs,
          }),
          token: app.token,
        }),
      },
      metrics: {
        GET: createMetricsHandler({
          logger: app.logger,
          reporter: app.reporter,
          metrics: app.metrics,
          token: app.token,
        }),
      },
    },
  };
}

/** ops: the health, alert and metrics routes bind here (`processRoute`). */
export const opsComposition = defineComposition('ops', (app) =>
  composeOpsRoutes({
    database: app.database,
    redis: app.redis,
    isDraining: app.isDraining,
    startupChecked: app.startupChecked,
    logger: app.logger,
    reporter: app.reporter,
    local: app.localAlertState,
    clock: app.clock,
    waits: app.waits,
    fileMaintenanceIntervalMs:
      app.messagingFiles?.maintenance?.intervalMs ?? null,
    token: () => app.opsProbeToken(),
    metrics: app.metrics,
  }),
);
