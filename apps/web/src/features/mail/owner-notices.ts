import { createAppError } from '@daisy/errors';
import type { EmailMessage } from './types';
import { retryOrFail } from './retry-policy';
import { runMailQueue } from './run-queue';

/** One claimed owner notice: the stored row's id, its attempts so far and its lease. */
type OwnerNoticeClaim = {
  readonly id: string;
  readonly attempts: number;
  readonly token: string;
};

/** The email one notice sends, rendered from the row read fresh at send time. */
type OwnerEmail = Omit<EmailMessage, 'to' | 'idempotencyKey'>;

/** How one owner notice ends, or that it waits for another attempt. */
export type OwnerNoticeOutcome =
  | { readonly kind: 'sent' }
  | {
      readonly kind: 'retry';
      readonly errorCode: 'delivery';
      readonly nextAttemptAt: string;
    }
  | {
      readonly kind: 'failed';
      readonly errorCode: 'delivery' | 'unreadable';
    }
  | {
      readonly kind: 'cancelled';
      readonly errorCode: 'not-owed' | 'suppressed';
    };

/**
 * A queue of emails to the owner's own address, one per stored row (a
 * League request, a support message). Each claim reads its row fresh
 * (`compose`: null once retention or erasure deleted it, which cancels the
 * notice), sends it under the row's id namespaced by `purpose` as the
 * provider idempotency key, and settles the outcome. A failed send backs
 * off, and the send that fails for good is reported, so a lost message
 * never goes unnoticed. A suppressed owner address is reported too: every
 * later notice would vanish the same way. The send happens outside any
 * transaction; a crash before settling only delays it, and the same key
 * keeps a resend single.
 */
export function createOwnerNotices<Claim extends OwnerNoticeClaim>(input: {
  /** Namespaces the idempotency key, so a row id never shares a provider key with another queue's job. */
  readonly purpose: string;
  /** What the report says when the owner's address is suppressed. */
  readonly suppressedMessage: string;
  readonly claim: (batch: {
    readonly limit: number;
    readonly leaseMs: number;
    readonly maxAttempts: number;
    readonly nextToken: () => string;
  }) => Promise<readonly Claim[]>;
  readonly compose: (id: string) => Promise<OwnerEmail | null>;
  readonly settle: (settle: {
    readonly id: string;
    readonly token: string;
    readonly outcome: OwnerNoticeOutcome;
  }) => Promise<boolean>;
  readonly deliver: (message: EmailMessage) => Promise<'sent' | 'suppressed'>;
  readonly ownerAddress: string;
  readonly nextToken: () => string;
  readonly now: () => string;
  /** A notice that could not be decided and will be tried again: logged by code, raw only to the reporter. */
  readonly failed: (error: unknown) => void;
  /**
   * A notice that failed for good: always reported, never deferred as
   * capacity backpressure, because nothing will try it again.
   */
  readonly gaveUp: (error: unknown) => void;
}) {
  /**
   * The next outcome after a failed attempt; the last one is reported as
   * lost and names what failed: the provider (`delivery`) or the stored
   * row (`unreadable`).
   */
  const afterFailure = (
    claim: Claim,
    error: unknown,
    cause: 'delivery' | 'unreadable',
    retrying: (error: unknown) => void,
  ): OwnerNoticeOutcome => {
    const outcome = retryOrFail(claim.attempts, input.now(), 'delivery');
    if (outcome.kind !== 'failed') {
      retrying(error);
      return outcome;
    }
    input.gaveUp(error);
    return { kind: 'failed', errorCode: cause };
  };
  const decide = async (claim: Claim): Promise<OwnerNoticeOutcome> => {
    const email = await input.compose(claim.id);
    if (email === null) return { kind: 'cancelled', errorCode: 'not-owed' };
    try {
      const sent = await input.deliver({
        ...email,
        to: input.ownerAddress,
        idempotencyKey: `${input.purpose}:${claim.id}`,
      });
      if (sent === 'sent') return { kind: 'sent' };
      input.gaveUp(createAppError('INFRASTRUCTURE', input.suppressedMessage));
      return { kind: 'cancelled', errorCode: 'suppressed' };
    } catch (error) {
      // Earlier provider failures retry silently, as other mail queues do.
      return afterFailure(claim, error, 'delivery', () => {});
    }
  };
  return {
    /** Sends up to `limit` due notices one after another; resolves to how many it settled. */
    run: (limit: number): Promise<number> =>
      runMailQueue({
        limit,
        nextToken: input.nextToken,
        claim: input.claim,
        decide,
        undecided: (claim, error) =>
          afterFailure(claim, error, 'unreadable', input.failed),
        settle: input.settle,
      }),
  };
}
