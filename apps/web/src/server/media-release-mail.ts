import type { Waits } from '@daisy/clock';
import type { ErrorReporter } from '@daisy/observability';
import { deriveRecipientSubkey } from '../features/mail/recipient-key';
import { startMailQueueWorker } from '../features/mail/queue-worker';
import { MAIL_QUEUE_BATCH } from '../features/mail/retry-policy';
import { newReleaseLinkToken } from '../features/media-releases/link-token';
import { createMediaReleaseMail } from '../features/media-releases/mail-delivery';
import { deriveReleaseStopSubkey } from '../features/media-releases/stop-token';
import type { App } from './app';
import { workerFailures } from './recoverable-failure';
import { nextWorkerToken } from './worker-token';

/**
 * The parent's media release email worker (ADR 0151): every web instance
 * runs it; the mail leases keep instances off each other's mail.
 */
export function startMediaReleaseMail(input: {
  readonly app: App;
  readonly waits: Waits;
  readonly reporter?: ErrorReporter;
}) {
  const { app } = input;
  const failed = workerFailures(app, input.reporter)(
    'media_release.mail.failed',
    'media_release.mail',
    'Media release email stays queued',
  );
  return startMailQueueWorker({
    run: async (limit) => {
      const secret = app.mailConfig().RECIPIENT_HASH_SECRET;
      return createMediaReleaseMail({
        store: app.database,
        deliver: (message) => app.deliverMail('media-release')(message),
        appUrl: app.config.PUBLIC_APP_URL,
        recipientSubkey: deriveRecipientSubkey(secret),
        stopSubkey: deriveReleaseStopSubkey(secret),
        newToken: newReleaseLinkToken,
        nextId: () => app.ids.next(),
        nextLeaseToken: nextWorkerToken,
        now: () => app.clock.now(),
        failed: (error) => failed(error, 'decide'),
      }).run(limit);
    },
    batch: MAIL_QUEUE_BATCH,
    everyMs: 15_000,
    waits: input.waits,
    failed: (error) => failed(error, 'send'),
  });
}
