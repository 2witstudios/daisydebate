import { knownDeliveryRejection } from '../mail/resend-sender';
import { operatorConsoleOrigin } from '@daisy/protocol';
import type { Database } from '@daisy/db';
import type { EmailMessage } from '../mail/types';
import { renderBetaEmail } from './templates';
import {
  clubInvitationPath,
  renderClubSeatInvitation,
} from '../clubs/invitation-email';
import { retryOrFail as backOff } from '../mail/retry-policy';
import { runMailQueue } from '../mail/run-queue';

type Store = Pick<
  Database,
  'claimMailIntents' | 'readMailIntentDelivery' | 'settleMailIntent'
>;
type Claim = Awaited<ReturnType<Store['claimMailIntents']>>[number];
type Outcome = Parameters<Store['settleMailIntent']>[0]['outcome'];

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
  readonly deliver: (message: EmailMessage) => Promise<'sent' | 'suppressed'>;
  /** The owner's digest address; absent, digests are cancelled as unconfigured. */
  readonly ownerAddress: string | undefined;
  readonly appUrl: string;
  readonly nextToken: () => string;
  readonly now: () => string;
  /** An intent that could not be decided: logged by code, raw only to the reporter. */
  readonly failed: (error: unknown) => void;
}) {
  const decide = async (claim: Claim): Promise<Outcome> => {
    const delivery = await input.store.readMailIntentDelivery(claim.id);
    if (delivery.kind === 'recipient-gone' || delivery.kind === 'not-owed')
      return { kind: 'cancelled', errorCode: delivery.kind };
    if (
      delivery.kind === 'invitation' &&
      Date.parse(input.now()) >= Date.parse(delivery.sendBefore)
    )
      return { kind: 'failed', errorCode: 'delivery-unknown' };
    // An owner digest with no owner address configured has nowhere to go.
    const addressed:
      | readonly [string, Pick<EmailMessage, 'subject' | 'text' | 'html'>]
      | null =
      delivery.kind === 'club-seat-invitation'
        ? [
            delivery.to,
            renderClubSeatInvitation({
              clubName: delivery.clubName,
              manager: delivery.manager,
              expiresAt: delivery.expiresAt,
              url: new URL(
                clubInvitationPath(
                  delivery.organizationId,
                  delivery.invitationId,
                ),
                input.appUrl,
              ).toString(),
            }),
          ]
        : delivery.kind === 'invitation'
          ? [
              delivery.to,
              renderBetaEmail({
                kind: 'beta-invitation',
                url: new URL('/sign-in', input.appUrl).toString(),
              }),
            ]
          : delivery.kind === 'member'
            ? [
                delivery.to,
                renderBetaEmail({
                  kind: 'beta-approved',
                  username: delivery.username,
                  url: new URL('/play', input.appUrl).toString(),
                }),
              ]
            : input.ownerAddress
              ? [
                  input.ownerAddress,
                  renderBetaEmail({
                    kind: 'beta-requests',
                    newRequests: delivery.newRequests,
                    waiting: delivery.waiting,
                    url: `${operatorConsoleOrigin}/accounts?access=pending`,
                  }),
                ]
              : null;
    if (!addressed) return { kind: 'cancelled', errorCode: 'unconfigured' };
    const [to, rendered] = addressed;
    try {
      const sent = await input.deliver({
        ...rendered,
        to,
        idempotencyKey: claim.id,
        ...(delivery.kind === 'invitation'
          ? { sendBefore: delivery.sendBefore }
          : {}),
      });
      return sent === 'sent'
        ? { kind: 'sent' }
        : { kind: 'cancelled', errorCode: 'suppressed' };
    } catch (error) {
      return retryOrFail(
        claim,
        claim.purpose === 'beta-invitation' && !knownDeliveryRejection(error)
          ? 'delivery-unknown'
          : 'delivery',
      );
    }
  };
  /** A failed attempt backs off, and fails for good at the attempt cap. */
  const retryOrFail = (
    claim: Claim,
    errorCode: 'delivery' | 'delivery-unknown' = 'delivery',
  ): Outcome => backOff(claim.attempts, input.now(), errorCode);
  return {
    /** Sends up to `limit` due intents one after another; resolves to how many it settled. */
    run: (limit: number): Promise<number> =>
      runMailQueue({
        limit,
        nextToken: input.nextToken,
        claim: input.store.claimMailIntents,
        decide,
        // One intent whose read fails (erased mid-lease, say) counts as a
        // failed attempt; it never aborts the rest of the batch (ISSUE-656).
        undecided: (claim, error) => {
          input.failed(error);
          return retryOrFail(claim);
        },
        settle: input.store.settleMailIntent,
      }),
  };
}
