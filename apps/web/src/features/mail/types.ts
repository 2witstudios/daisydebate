/**
 * The mail transport's contract: one message shape, sender and delivery
 * ledger for every product email, whatever its purpose (auth, beta access).
 */
export type EmailMessage = {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  /**
   * The provider idempotency key when the caller owns one (a durable mail
   * intent's id, ADR 0075), so a resend after a crash is not doubled.
   * Absent, each send gets a fresh key.
   */
  readonly idempotencyKey?: string;
};
/** Provider receipt; correlates later delivery events, holds no recipient data. */
type EmailReceipt = { readonly providerMessageId: string };
export type EmailSender = {
  readonly send: (message: EmailMessage) => Promise<EmailReceipt | void>;
};
/** Durable mail diagnostics + suppression owned by @daisy/db. */
export type DeliveryLedger = {
  readonly isSuppressed: (recipientHash: string) => Promise<boolean>;
  readonly record: (input: {
    readonly providerMessageId: string;
    readonly recipientHash: string;
    readonly at: string;
  }) => Promise<void>;
};

/** Why a mail is sent; every transport event carries it. */
export type MailPurpose = 'auth' | 'beta-access';

/**
 * The one suppression-honouring path (`send-mail.ts`): `suppressed` when the
 * recipient hard-bounced or complained, so nothing was sent (ADR 0025,
 * ISSUE-54).
 */
export type Deliver = (message: EmailMessage) => Promise<'sent' | 'suppressed'>;
