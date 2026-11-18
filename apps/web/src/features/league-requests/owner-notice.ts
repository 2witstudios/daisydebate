import type { Database } from '@daisy/db';
import type { EmailMessage } from '../mail/types';
import {
  MAIL_LEASE_MS,
  MAIL_MAX_ATTEMPTS,
  MAIL_QUEUE_BATCH,
  retryOrFail,
} from '../mail/retry-policy';
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
 * the request's own idempotency key and settles the outcome. A request gone
 * before its turn (retention) is cancelled; a failed send backs off until it
 * fails for good. The send happens outside any transaction; a crash before
 * settling only delays it, and the same key keeps a resend single.
 */
export function createLeagueRequestNotices(input: {
  readonly store: Store;
  readonly deliver: (message: EmailMessage) => Promise<'sent' | 'suppressed'>;
  readonly ownerAddress: string;
  readonly nextToken: () => string;
  readonly now: () => string;
  /** A notice that could not be decided: logged by code, raw only to the reporter. */
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
        idempotencyKey: claim.id,
      });
      return sent === 'sent'
        ? { kind: 'sent' }
        : { kind: 'cancelled', errorCode: 'suppressed' };
    } catch {
      return retry(claim);
    }
  };
  return {
    /** Sends up to `limit` due notices one after another; resolves to how many it settled. */
    async run(limit: number): Promise<number> {
      const claims = await input.store.claimLeagueRequestNotices({
        limit: Math.min(limit, MAIL_QUEUE_BATCH),
        leaseMs: MAIL_LEASE_MS,
        maxAttempts: MAIL_MAX_ATTEMPTS,
        nextToken: input.nextToken,
      });
      let settled = 0;
      for (const claim of claims) {
        // One notice whose read fails counts as a failed attempt; it never
        // aborts the rest of the batch.
        const outcome = await decide(claim).catch((error: unknown) => {
          input.failed(error);
          return retry(claim);
        });
        if (
          await input.store.settleLeagueRequestNotice({
            id: claim.id,
            token: claim.token,
            outcome,
          })
        )
          settled += 1;
      }
      return settled;
    },
  };
}
