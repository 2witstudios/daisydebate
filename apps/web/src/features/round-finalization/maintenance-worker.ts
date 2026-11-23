import type { JudgingTerminalReason } from '@daisy/protocol/round-judging-attempt';
import { createAppError } from '@daisy/errors';
import type { ErrorReporter } from '@daisy/observability';
import { workerFailures } from '../../server/recoverable-failure';
import type { App } from '../../server/app';
import { createAttendanceFeature } from '../attendance/operations';
import { createRoundMaintenanceOperations } from './maintenance';
import { startRoundMaintenance } from './service';
import { readPublicCheckInProbe } from '../availability/configuration';
/** The existing availability lease supplies service authority; no new lease/pool is created. */
export function startRoundCompetitiveMaintenance(input: {
  readonly app: App;
  readonly instanceId: string;
  readonly waits: Parameters<typeof startRoundMaintenance>[0]['waits'];
  readonly wake?: Parameters<typeof startRoundMaintenance>[0]['wake'];
  readonly ratingWake?: Parameters<
    typeof startRoundMaintenance
  >[0]['ratingWake'];
  /** Scrubbed raw-error destination (ADR 0037); inert until configured. */
  readonly reporter?: ErrorReporter;
}) {
  const { app, instanceId } = input;
  const reportEnded = workerFailures(app, input.reporter)(
    'round.judging.failed',
    'round.judging',
    'Judging ended without a ballot',
  );
  const judgingEnded = (reason: JudgingTerminalReason) =>
    reportEnded(
      createAppError('INFRASTRUCTURE', `Judging ended: ${reason}`),
      'complete',
    );
  const attendance = createAttendanceFeature({
    checkIns: app.database,
    evaluate: app.database.evaluateRoundAttendance,
    nextId: () => app.ids.next(),
    instanceId,
    judgingEnded,
  });
  return startRoundMaintenance({
    ...createRoundMaintenanceOperations({
      store: app.database,
      instanceId,
      ids: app.ids,
      evaluate: attendance.evaluate,
      judgingEnded,
      platformEnded: (roundId) => {
        app.logger.log(
          'round.incident.ended',
          { roundId },
          'A platform incident ended this Round',
        );
        input.reporter?.capture(
          createAppError(
            'INFRASTRUCTURE',
            'A Round lost more speech than can be judged',
          ),
          {
            requestId: app.ids.next(),
            route: 'round.incident.ended',
            errorCode: 'INFRASTRUCTURE',
          },
        );
      },
      ratingFailed: (_roundId, error) =>
        workerFailures(app, input.reporter)(
          'round.maintenance.failed',
          'round.maintenance',
          'Competitive maintenance remains recoverable',
        )(error, 'rate'),
      probeRoundId:
        readPublicCheckInProbe(
          app.config.ATTENDANCE_PUBLIC_PROBE,
          app.config.PUBLIC_APP_URL,
        )?.roundId ?? null,
    }),
    waits: input.waits,
    wake: input.wake,
    ratingWake: input.ratingWake,
    now: () => performance.now(),
    held: ({ rounds, oldestMs }) =>
      app.logger.log(
        'round.attendance.held',
        { pending: rounds, oldestAgeMs: oldestMs },
        'Rounds held by an uncertain check-in writer',
      ),
    failed: workerFailures(app, input.reporter)(
      'round.maintenance.failed',
      'round.maintenance',
      'Competitive maintenance remains recoverable',
    ),
  });
}
