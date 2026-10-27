import { operatorConsoleOrigin } from '@daisy/protocol';
import type { Database } from '@daisy/db';
import type { AuthEmailMessage } from '../auth/mail/mail-types';
import { renderBetaEmail } from './templates';
import { MAIL_INTENT_MAX_ATTEMPTS, mailRetryDelayMs } from './retry-policy';

type Store = Pick<
  Database,
  'claimMailIntents' | 'readMailIntentDelivery' | 'settleMailIntent'
>;
type Claim = Awaited<ReturnType<Store['claimMailIntents']>>[number];
type Outcome = Parameters<Store['settleMailIntent']>[0]['outcome'];

/** A lease covers one provider call with its single retry (10 s budget) and the reads around it. */
const LEASE_MS = 60_000;

/**
 * Sends the durable mail intents that are due (ADR 0075). Each claim reads
 * what the mail should say now, renders it, sends it under the intent's own
 * idempotency key and settles the outcome. An erased recipient, a revoked
 * approval or a missing owner address cancels instead of sending; a failed
 * send retries with backoff until it fails for good. The send happens
 * outside any transaction, and a crash before settling only delays it: the
 * lease lapses and the next claim sends again under the same key.
 */
export function createMailIntentDelivery(input: {
  readonly store: Store;
  readonly deliver: (
    message: AuthEmailMessage,
  ) => Promise<'sent' | 'suppressed'>;
  /** The owner's digest address; absent, digests are cancelled as unconfigured. */
  readonly ownerAddress: string | undefined;
  readonly appUrl: string;
  readonly nextToken: () => string;
  readonly now: () => string;
}) {
  const decide = async (claim: Claim): Promise<Outcome> => {
    const delivery = await input.store.readMailIntentDelivery(claim.id);
    if (delivery.kind === 'recipient-gone' || delivery.kind === 'not-owed')
      return { kind: 'cancelled', errorCode: delivery.kind };
    if (delivery.kind === 'owner-digest' && !input.ownerAddress)
      return { kind: 'cancelled', errorCode: 'unconfigured' };
    const [to, rendered] =
      delivery.kind === 'member'
        ? [
            delivery.to,
            renderBetaEmail({
              kind: 'beta-approved',
              username: delivery.username,
              url: new URL('/play', input.appUrl).toString(),
            }),
          ]
        : [
            input.ownerAddress!,
            renderBetaEmail({
              kind: 'beta-requests',
              newRequests: delivery.newRequests,
              waiting: delivery.waiting,
              url: `${operatorConsoleOrigin}/accounts?access=pending`,
            }),
          ];
    try {
      const sent = await input.deliver({
        ...rendered,
        to,
        idempotencyKey: claim.id,
      });
      return sent === 'sent'
        ? { kind: 'sent' }
        : { kind: 'cancelled', errorCode: 'suppressed' };
    } catch {
      if (claim.attempts >= MAIL_INTENT_MAX_ATTEMPTS)
        return { kind: 'failed', errorCode: 'delivery' };
      return {
        kind: 'retry',
        errorCode: 'delivery',
        nextAttemptAt: new Date(
          Date.parse(input.now()) + mailRetryDelayMs(claim.attempts),
        ).toISOString(),
      };
    }
  };
  return {
    /** Sends up to `limit` due intents one after another; resolves to how many it settled. */
    async run(limit: number): Promise<number> {
      const claims = await input.store.claimMailIntents({
        limit,
        leaseMs: LEASE_MS,
        nextToken: input.nextToken,
      });
      let settled = 0;
      for (const claim of claims) {
        const outcome = await decide(claim);
        if (
          await input.store.settleMailIntent({
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
