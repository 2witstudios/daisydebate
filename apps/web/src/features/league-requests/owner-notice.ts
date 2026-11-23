import type { LeagueRequestsStore } from '@daisy/db/stores/league-requests';
import { createAppError } from '@daisy/errors';
import type { EmailMessage } from '../mail/types';
import { retryOrFail } from '../mail/retry-policy';
import { runMailQueue } from '../mail/run-queue';
import { renderLeagueRequestEmail } from './owner-email';

type Store = Pick<
  LeagueRequestsStore,
  | 'claimLeagueRequestNotices'
  | 'readLeagueRequestNotice'
  | 'settleLeagueRequestNotice'
>;
type Claim = Awaited<ReturnType<Store['claimLeagueRequestNotices']>>[number];
type Outcome = Parameters<Store['settleLeagueRequestNotice']>[0]['outcome'];

/**
 * Tells the owner about each League request that is due (PYL-17). Each claim
 * reads the request fresh, renders it, sends it to the owner's address under
 * the request's id as the idempotency key, and settles the
 * outcome. A request gone before its turn (retention) is cancelled; a failed
 * send backs off, and the send that fails for good is reported, so a lost
 * lead never goes unnoticed. The send happens outside any transaction; a
 * crash before settling only delays it, and the same key keeps a resend
 * single.
 */
export function createLeagueRequestNotices(input: {
  readonly store: Store;
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
   * request (`unreadable`).
   */
  const afterFailure = (
    claim: Claim,
    error: unknown,
    cause: 'delivery' | 'unreadable',
    retrying: (error: unknown) => void,
  ): Outcome => {
    const outcome = retryOrFail(claim.attempts, input.now(), 'delivery');
    if (outcome.kind !== 'failed') {
      retrying(error);
      return outcome;
    }
    input.gaveUp(error);
    return { kind: 'failed', errorCode: cause };
  };
  const decide = async (claim: Claim): Promise<Outcome> => {
    const notice = await input.store.readLeagueRequestNotice(claim.id);
    if (notice.kind === 'gone')
      return { kind: 'cancelled', errorCode: 'not-owed' };
    try {
      const sent = await input.deliver({
        ...renderLeagueRequestEmail(notice.request),
        to: input.ownerAddress,
        // Namespaced: a client-chosen request id never shares a provider
        // key with another mail queue's job.
        idempotencyKey: `league-request:${claim.id}`,
      });
      if (sent === 'sent') return { kind: 'sent' };
      // The owner's own address bounced or complained: every later lead
      // would vanish the same way, so it is reported, not just recorded.
      input.gaveUp(
        createAppError(
          'INFRASTRUCTURE',
          'League request owner address is suppressed',
        ),
      );
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
        claim: input.store.claimLeagueRequestNotices,
        decide,
        undecided: (claim, error) =>
          afterFailure(claim, error, 'unreadable', input.failed),
        settle: input.store.settleLeagueRequestNotice,
      }),
  };
}
