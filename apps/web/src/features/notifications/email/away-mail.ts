import { knownDeliveryRejection } from '../../mail/resend-sender';
import {
  MAIL_LEASE_MS,
  MAIL_MAX_ATTEMPTS,
  MAIL_QUEUE_BATCH,
  retryOrFail,
} from '../../mail/retry-policy';
import type { EmailMessage } from '../../mail/types';
import { oneClickUnsubscribeUrl, unsubscribeUrl } from './unsubscribe-token';

/** How long a job waits again while its member is in Daisy (ADR 0144). */
const DIGEST_ONLINE_POSTPONE_MS = 15 * 60_000;

type Held = { readonly id: string; readonly token: string };
type Claim = Held & { readonly attempts: number };

/** How a held job ends, as the shared mail queue records it. */
type Outcome<Code extends string> =
  | { readonly kind: 'sent' }
  | {
      readonly kind: 'retry';
      readonly errorCode: 'delivery' | 'delivery-unknown';
      readonly nextAttemptAt: string;
    }
  | {
      readonly kind: 'failed' | 'cancelled';
      readonly errorCode: Code | 'suppressed' | 'delivery' | 'delivery-unknown';
    };

/** What a job's send-time read says: send this, or cancel with a reason. */
export type AwayMailRead<Code extends string, Send> =
  | ({ readonly kind: 'send' } & Send & {
        readonly to: string;
        readonly userId: string;
        readonly actorId: string;
      })
  | { readonly kind: 'cancel'; readonly errorCode: Code };

/**
 * The one delivery loop for mail sent to a member who is away (ADR 0144):
 * the notification digest and Messaging's unread-messages email. Each claim
 * is read fresh; one whose member is in Daisy waits again, since they see it
 * there; otherwise it is rendered with the unsubscribe that stops
 * notification email, sent under the job's own idempotency key and settled.
 * A failed send retries with backoff until it fails for good; a job whose
 * read fails counts a failed attempt and never aborts the batch (ISSUE-656).
 */
export function createAwayMailDelivery<
  Code extends string,
  Send,
  O extends Outcome<Code>,
>(input: {
  readonly claim: (limit: {
    readonly limit: number;
    readonly leaseMs: number;
    readonly maxAttempts: number;
    readonly nextToken: () => string;
  }) => Promise<readonly Claim[]>;
  readonly read: (id: string) => Promise<AwayMailRead<Code, Send>>;
  readonly render: (
    read: Extract<AwayMailRead<Code, Send>, { kind: 'send' }>,
    unsubscribeUrl: string,
  ) => Omit<EmailMessage, 'to' | 'idempotencyKey' | 'headers'>;
  readonly settle: (held: Held & { readonly outcome: O }) => Promise<boolean>;
  readonly postpone: (
    held: Held & { readonly until: string },
  ) => Promise<boolean>;
  readonly deliver: (message: EmailMessage) => Promise<'sent' | 'suppressed'>;
  /** Whether the member is in Daisy now; unknown should be false. */
  readonly isOnline: (actorId: string) => Promise<boolean>;
  readonly appUrl: string;
  readonly unsubscribeSubkey: string;
  readonly nextToken: () => string;
  readonly now: () => string;
  /** A job that could not be decided: logged by code, raw only to the reporter. */
  readonly failed: (error: unknown) => void;
}) {
  type Decision =
    | { readonly kind: 'settle'; readonly outcome: O }
    | { readonly kind: 'postpone'; readonly until: string };
  const settled = (outcome: Outcome<Code>): Decision => ({
    kind: 'settle',
    outcome: outcome as O,
  });
  const backOff = (
    claim: Claim,
    errorCode: 'delivery' | 'delivery-unknown' = 'delivery',
  ) => settled(retryOrFail(claim.attempts, input.now(), errorCode));
  const decide = async (claim: Claim): Promise<Decision> => {
    const read = await input.read(claim.id);
    if (read.kind === 'cancel')
      return settled({ kind: 'cancelled', errorCode: read.errorCode });
    if (await input.isOnline(read.actorId))
      return {
        kind: 'postpone',
        until: new Date(
          Date.parse(input.now()) + DIGEST_ONLINE_POSTPONE_MS,
        ).toISOString(),
      };
    const optOut = { userId: read.userId };
    const oneClick = oneClickUnsubscribeUrl(
      input.appUrl,
      input.unsubscribeSubkey,
      optOut,
    );
    const rendered = input.render(
      read,
      unsubscribeUrl(input.appUrl, input.unsubscribeSubkey, optOut),
    );
    try {
      const sent = await input.deliver({
        ...rendered,
        to: read.to,
        idempotencyKey: claim.id,
        headers: {
          'List-Unsubscribe': `<${oneClick}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      });
      return settled(
        sent === 'sent'
          ? { kind: 'sent' }
          : { kind: 'cancelled', errorCode: 'suppressed' },
      );
    } catch (error) {
      return backOff(
        claim,
        knownDeliveryRejection(error) ? 'delivery' : 'delivery-unknown',
      );
    }
  };
  return {
    /** Decides up to `limit` due jobs one after another; resolves to how many it settled or put back. */
    async run(limit: number): Promise<number> {
      const claims = await input.claim({
        limit: Math.min(limit, MAIL_QUEUE_BATCH),
        leaseMs: MAIL_LEASE_MS,
        maxAttempts: MAIL_MAX_ATTEMPTS,
        nextToken: input.nextToken,
      });
      let handled = 0;
      for (const claim of claims) {
        const decision = await decide(claim).catch((error: unknown) => {
          input.failed(error);
          return backOff(claim);
        });
        const held = { id: claim.id, token: claim.token };
        if (
          decision.kind === 'postpone'
            ? await input.postpone({ ...held, until: decision.until })
            : await input.settle({ ...held, outcome: decision.outcome })
        )
          handled += 1;
      }
      return handled;
    },
  };
}
