import type { Database } from '@daisy/db';
import type { EmailMessage } from '../mail/types';
import { retryOrFail } from '../mail/retry-policy';
import { runMailQueue } from '../mail/run-queue';
import { renderLeagueRequestEmail } from './owner-email';

type Store = Pick<
  Database,
  | 'claimLeagueRequestNotices'
  | 'readLeagueRequestNotice'
  | 'settleLeagueRequestNotice'
>;
type Claim = Awaited<ReturnType<Store['claimLeagueRequestNotices']>>[number];
type Outcome = Parameters<Store['settleLeagueRequestNotice']>[0]['outcome'];

/**
 * Tells the owner about each League request that is due (PYL-17). Each claim
 * reads the request fresh, renders it, sends it to the owner's address under
 * the request's id and revision as the idempotency key, and settles the
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
  /** A notice that could not be decided or sent for good: logged by code, raw only to the reporter. */
  readonly failed: (error: unknown) => void;
}) {
  const retry = (claim: Claim): Outcome =>
    retryOrFail(claim.attempts, input.now(), 'delivery');
  const decide = async (claim: Claim): Promise<Outcome> => {
    const notice = await input.store.readLeagueRequestNotice(claim.id);
    if (notice.kind === 'gone')
      return { kind: 'cancelled', errorCode: 'not-owed' };
    try {
      const sent = await input.deliver({
        ...renderLeagueRequestEmail(notice.request),
        to: input.ownerAddress,
        // The revision read is the one rendered, so each version sends once.
        idempotencyKey: `${claim.id}-${notice.request.revision}`,
      });
      return sent === 'sent'
        ? { kind: 'sent' }
        : { kind: 'cancelled', errorCode: 'suppressed' };
    } catch (error) {
      const outcome = retry(claim);
      if (outcome.kind === 'failed') input.failed(error);
      return outcome;
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
        undecided: (claim, error) => {
          input.failed(error);
          return retry(claim);
        },
        settle: input.store.settleLeagueRequestNotice,
      }),
  };
}
