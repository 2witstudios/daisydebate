import { createAppError } from '@daisy/errors';
import type { Clock } from '@daisy/clock';
import type { Logger } from '@daisy/logger';
import type { Deliver } from './deliver-or-unavailable';
import type { AuthDeliveryLedger, AuthEmailSender } from './mail-types';
import { recipientKey } from './recipient-key';
import type { ProviderLatency, SendPacing } from './send-pacing';

/**
 * ISSUE-54: every auth mail, required or best-effort, goes through this
 * one path, and it honours suppression before anything reaches the
 * transport. A ledger outage is a failed send (callers fail closed or log),
 * never an implicit allow.
 */
export const createSendMail =
  (dependencies: {
    readonly recipientSubkey: string;
    readonly ledger: AuthDeliveryLedger;
    readonly emailSender: AuthEmailSender;
    readonly logger: Logger;
    readonly clock: Clock;
    readonly pacing: SendPacing;
    /**
     * Every send that reaches the provider, delivered or failed, is measured
     * into it from its suppression read to its end (receipt write included).
     */
    readonly latency: ProviderLatency;
  }): Deliver =>
  async (message) => {
    const { pacing, latency } = dependencies;
    const started = pacing.elapsedMs();
    const recipientHash = recipientKey(
      dependencies.recipientSubkey,
      message.to,
    );
    if (await dependencies.ledger.isSuppressed(recipientHash)) {
      dependencies.logger.log(
        'auth.mail.suppressed',
        { operation: 'auth.mail.send' },
        'Auth mail not sent: the recipient is suppressed',
      );
      return 'suppressed';
    }
    let receipt: Awaited<ReturnType<AuthEmailSender['send']>>;
    try {
      receipt = await dependencies.emailSender.send(message);
    } catch (error) {
      latency.observe(pacing.elapsedMs() - started);
      // Delivery failure is a generic retryable outcome: never surface
      // or log the provider exception, recipient or message body here.
      dependencies.logger.log(
        'auth.mail.failed',
        { operation: 'auth.mail.send', errorCode: 'INFRASTRUCTURE' },
        'Auth mail delivery failed',
      );
      throw createAppError('INFRASTRUCTURE', undefined, error);
    }
    if (receipt) {
      try {
        await dependencies.ledger.record({
          providerMessageId: receipt.providerMessageId,
          recipientHash,
          at: dependencies.clock.now(),
        });
      } catch {
        // The provider accepted the message, so the user has their email:
        // report success. The opaque provider id (no recipient data) keeps
        // the send reconcilable for bounce and complaint correlation.
        dependencies.logger.log(
          'auth.mail.receipt_failed',
          {
            operation: 'auth.mail.send',
            errorCode: 'INFRASTRUCTURE',
            providerMessageId: receipt.providerMessageId,
          },
          'Auth mail receipt was not recorded',
        );
      }
    }
    latency.observe(pacing.elapsedMs() - started);
    dependencies.logger.log(
      'auth.mail.sent',
      { operation: 'auth.mail.send' },
      'Auth mail delivered',
    );
    return 'sent';
  };

/**
 * What a dropped sign-up does in place of a send (ISSUE-185, DEC-41), in
 * the same order against the same resources: the same suppression read,
 * a wait, then its one write (`write`, the token delete, where a send
 * records its receipt), ending when a send drawn from the recent ones
 * would have ended. The write starts its own measured cost before that
 * end, and a timer runs to the end itself (early by its measured
 * lateness), so the end follows the send's distribution rather than
 * adding the stand-in's own costs to it. So the handed-off work's slot is
 * held, and the pool read and written, on the same schedule whether or not
 * the address has an account. Where a send would stop before the provider
 * (a suppressed recipient, a ledger outage) it writes at once, as the
 * send's caller deletes then.
 */
export const createSendStandIn =
  (dependencies: {
    readonly recipientSubkey: string;
    readonly ledger: AuthDeliveryLedger;
    readonly pacing: SendPacing;
    readonly latency: ProviderLatency;
  }) =>
  async (to: string, write: () => Promise<unknown>): Promise<void> => {
    const { pacing, latency } = dependencies;
    const until = pacing.elapsedMs() + latency.sample();
    let suppressed = true;
    try {
      suppressed = await dependencies.ledger.isSuppressed(
        recipientKey(dependencies.recipientSubkey, to),
      );
    } catch {
      // A ledger outage stops a send before the provider too.
    }
    if (suppressed) {
      await write();
      return;
    }
    /** Waits until `at` less the timer's measured lateness, measuring it. */
    const waitUntil = async (at: number) => {
      const from = pacing.elapsedMs();
      const requested = at - from - latency.lateness();
      if (requested <= 0) return;
      await pacing.delay(requested);
      latency.observeLateness(pacing.elapsedMs() - from - requested);
    };
    await waitUntil(until - latency.writeCost());
    const writeFrom = pacing.elapsedMs();
    await Promise.all([
      write().then(() =>
        latency.observeWriteCost(pacing.elapsedMs() - writeFrom),
      ),
      waitUntil(until),
    ]);
  };
