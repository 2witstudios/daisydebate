import type { Waits } from '@daisy/clock';
import type { ErrorReporter } from '@daisy/observability';
import { startMailQueueWorker } from '../mail/queue-worker';
import { MAIL_QUEUE_BATCH } from '../mail/retry-policy';
import { createNotificationDigestDelivery } from './email/delivery';
import { createUnreadMessagesEmailDelivery } from '../messaging/unread-email';
import type { EmailMessage } from '../mail/types';
import { deriveUnsubscribeSubkey } from './email/unsubscribe-token';
import type { App } from '../../server/app';
import { workerFailures } from '../../server/recoverable-failure';
import { nextWorkerToken } from '../../server/worker-token';

/**
 * The notification email worker (ADR 0124, ADR 0144): the notification
 * digest and Messaging's unread-messages email. Every web instance runs it,
 * and the job leases keep instances off each other's mail.
 */
export function startNotificationMail(input: {
  readonly app: App;
  readonly waits: Waits;
  readonly reporter?: ErrorReporter;
}) {
  const { app } = input;
  const failed = workerFailures(app, input.reporter)(
    'notification.mail.failed',
    'notification.mail',
    'Notification email stays queued',
  );
  // A live connection in any tab means the member sees it in Daisy.
  // Presence down reads as away: a late email beats a lost one.
  const isOnline = async (actorId: string) => {
    try {
      const { connections, nowMs } =
        await app.redis.readActorConnections(actorId);
      return connections.some((connection) => connection.expiresAtMs > nowMs);
    } catch {
      return false;
    }
  };
  const shared = {
    store: app.database,
    deliver: (message: EmailMessage) =>
      app.deliverMail('notification')(message),
    isOnline,
    appUrl: app.config.PUBLIC_APP_URL,
    unsubscribeSubkey: deriveUnsubscribeSubkey(
      app.mailConfig().RECIPIENT_HASH_SECRET,
    ),
    nextToken: nextWorkerToken,
    now: () => app.clock.now(),
    failed: (error: unknown) => failed(error, 'decide'),
  };
  return startMailQueueWorker({
    // The digest, then Messaging's unread-messages email, on one tick.
    run: async (limit) =>
      (await createNotificationDigestDelivery(shared).run(limit)) +
      (await createUnreadMessagesEmailDelivery(shared).run(limit)),
    batch: MAIL_QUEUE_BATCH,
    everyMs: 5_000,
    waits: input.waits,
    failed: (error) => failed(error, 'send'),
  });
}
