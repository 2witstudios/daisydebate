import { createAppError } from '@daisy/errors';
import type { Clock } from '@daisy/clock';
import type { Logger } from '@daisy/logger';
import type {
  Deliver,
  DeliveryLedger,
  EmailSender,
  MailPurpose,
} from './types';
import { recipientKey } from './recipient-key';

/**
 * ISSUE-54: every product mail, required or best-effort, goes through this
 * one path, and it honours suppression before anything reaches the
 * transport. Composition binds each caller's purpose, which every event
 * carries. A ledger outage is a failed send (callers fail closed or log),
 * never an implicit allow.
 */
export const createSendMail =
  (dependencies: {
    readonly recipientSubkey: string;
    readonly ledger: DeliveryLedger;
    readonly emailSender: EmailSender;
    readonly logger: Logger;
    readonly clock: Clock;
  }) =>
  (purpose: MailPurpose): Deliver =>
  async (message) => {
    const fields = { operation: 'mail.send', purpose } as const;
    const recipientHash = recipientKey(
      dependencies.recipientSubkey,
      message.to,
    );
    if (await dependencies.ledger.isSuppressed(recipientHash)) {
      dependencies.logger.log(
        'mail.suppressed',
        fields,
        'Mail not sent: the recipient is suppressed',
      );
      return 'suppressed';
    }
    let receipt: Awaited<ReturnType<EmailSender['send']>>;
    try {
      receipt = await dependencies.emailSender.send(message);
    } catch (error) {
      // Delivery failure is a generic retryable outcome: never surface
      // or log the provider exception, recipient or message body here.
      dependencies.logger.log(
        'mail.failed',
        { ...fields, errorCode: 'INFRASTRUCTURE' },
        'Mail delivery failed',
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
          'mail.receipt_failed',
          {
            ...fields,
            errorCode: 'INFRASTRUCTURE',
            providerMessageId: receipt.providerMessageId,
          },
          'Mail receipt was not recorded',
        );
      }
    }
    dependencies.logger.log('mail.sent', fields, 'Mail delivered');
    return 'sent';
  };
