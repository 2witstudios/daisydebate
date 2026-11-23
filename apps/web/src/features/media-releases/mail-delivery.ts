import {
  type MediaReleaseMailKind,
  type MediaReleaseStore,
} from '@daisy/db/stores/media-releases';
import type { ReleaseLinkPurpose } from '@daisy/protocol/media-release';
import type { EmailMessage } from '../mail/types';
import { recipientKey } from '../mail/recipient-key';
import { retryOrFail } from '../mail/retry-policy';
import { runMailQueue } from '../mail/run-queue';
import { renderReleaseMail } from './emails';
import { releaseLinkDigest, releaseLinkPath } from './link-token';
import { releaseStopPath } from './stop-token';

type Store = Pick<
  MediaReleaseStore,
  | 'claimMediaReleaseMails'
  | 'prepareMediaReleaseMail'
  | 'settleMediaReleaseMail'
>;
type Claim = Awaited<ReturnType<Store['claimMediaReleaseMails']>>[number];
type Outcome = Parameters<Store['settleMediaReleaseMail']>[0]['outcome'];

/** Which link a mail carries: a request and its reminder sign; the rest manage. */
const linkPurposeOf = (kind: MediaReleaseMailKind): ReleaseLinkPurpose =>
  kind === 'request' || kind === 'reminder' ? 'sign' : 'manage';

/**
 * Sends each due parent email (ADR 0151). Its link is minted here: a fresh
 * token whose digest is stored, with a check that the mail is still owed, in
 * one transaction before the provider is called. A retried send stores
 * another link, and the provider's idempotency key (the mail's id) keeps the
 * parent from getting the email twice; the link already delivered keeps
 * working. A mail no longer owed (the request ended, the release withdrawn)
 * is cancelled.
 */
export function createMediaReleaseMail(input: {
  readonly store: Store;
  readonly deliver: (message: EmailMessage) => Promise<'sent' | 'suppressed'>;
  readonly appUrl: string;
  readonly recipientSubkey: string;
  readonly stopSubkey: string;
  readonly newToken: () => string;
  readonly nextId: () => string;
  readonly nextLeaseToken: () => string;
  readonly now: () => string;
  /** A mail that could not be decided and will be tried again. */
  readonly failed: (error: unknown) => void;
}) {
  const absolute = (path: string) => new URL(path, input.appUrl).toString();
  const decide = async (claim: Claim): Promise<Outcome> => {
    const purpose = linkPurposeOf(claim.kind);
    const token = input.newToken();
    const prepared = await input.store.prepareMediaReleaseMail({
      mailId: claim.id,
      linkId: input.nextId(),
      tokenDigest: releaseLinkDigest(purpose, token),
    });
    if (prepared.kind === 'not-owed')
      return { kind: 'cancelled', errorCode: 'not-owed' };
    try {
      const sent = await input.deliver({
        ...renderReleaseMail(prepared, {
          url: absolute(releaseLinkPath(purpose, token)),
          stopUrl: absolute(
            releaseStopPath(
              input.stopSubkey,
              recipientKey(input.recipientSubkey, prepared.recipientEmail),
            ),
          ),
          manageUrl: absolute('/release/manage'),
        }),
        to: prepared.recipientEmail,
        idempotencyKey: `media-release:${claim.id}`,
      });
      return sent === 'sent'
        ? { kind: 'sent' }
        : { kind: 'cancelled', errorCode: 'suppressed' };
    } catch {
      return retryOrFail(claim.attempts, input.now(), 'delivery');
    }
  };
  return {
    run: (limit: number): Promise<number> =>
      runMailQueue({
        limit,
        nextToken: input.nextLeaseToken,
        claim: input.store.claimMediaReleaseMails,
        decide,
        undecided: (claim, error) => {
          input.failed(error);
          return retryOrFail(claim.attempts, input.now(), 'delivery');
        },
        settle: input.store.settleMediaReleaseMail,
      }),
  };
}
