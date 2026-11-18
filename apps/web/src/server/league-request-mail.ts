import type { ErrorReporter } from '@daisy/observability';
import { createLeagueRequestNotices } from '../features/league-requests/owner-notice';
import { startMailQueueWorker } from '../features/mail/queue-worker';
import { MAIL_QUEUE_BATCH } from '../features/mail/retry-policy';
import type { WorkerTimers } from '../lib/worker-timers';
import type { App } from './app';
import { workerFailures } from './recoverable-failure';
import { nextWorkerToken } from './worker-token';

/**
 * The League request email worker (PYL-17): every web instance runs it, and
 * the notice leases keep instances off each other's mail. Without an owner
 * address it does not run, so requests stay stored and their email waits
 * queued until one is set; the start says so once.
 */
export function startLeagueRequestMail(input: {
  readonly app: App;
  readonly timers: WorkerTimers;
  readonly reporter?: ErrorReporter;
}) {
  const { app } = input;
  const ownerAddress = app.config.LEAGUE_REQUEST_NOTIFY_EMAIL;
  if (!ownerAddress) {
    app.logger.log(
      'league_request.mail.unconfigured',
      { operation: 'league_request.mail' },
      'League request email waits: no owner address is configured',
    );
    return null;
  }
  const failed = workerFailures(app, input.reporter)(
    'league_request.mail.failed',
    'league_request.mail',
    'League request email stays queued',
  );
  return startMailQueueWorker({
    run: (limit) =>
      createLeagueRequestNotices({
        store: app.database,
        deliver: (message) => app.deliverMail('league-request')(message),
        ownerAddress,
        nextToken: nextWorkerToken,
        now: () => app.clock.now(),
        failed: (error) => failed(error, 'decide'),
      }).run(limit),
    batch: MAIL_QUEUE_BATCH,
    everyMs: 15_000,
    timers: input.timers,
    failed: (error) => failed(error, 'send'),
  });
}
