import type { IdGenerator } from '@daisy/clock';
import type { EmailMessage, EmailSender } from './types';

const ENDPOINT = 'https://api.resend.com/emails';

/** Outbound HTTP as the transport uses it: a request in, a response out. */
export type Fetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/** Failure carries a status class only: never the body, recipient or link. */
class DeliveryError extends Error {
  constructor(
    readonly transient: boolean,
    readonly status?: number,
    readonly uncertain = status === undefined ||
      status < 400 ||
      status >= 500 ||
      status === 408 ||
      status === 409,
  ) {
    super('Email delivery failed');
  }
}

/** True only for a definite provider rejection; lost or malformed replies remain unknown. */
export function knownDeliveryRejection(error: unknown): boolean {
  const cause = error instanceof Error && error.cause ? error.cause : error;
  return (
    cause instanceof DeliveryError &&
    !cause.uncertain &&
    cause.status !== undefined &&
    cause.status >= 400 &&
    cause.status < 500 &&
    cause.status !== 408 &&
    cause.status !== 409
  );
}

/**
 * A 409 on an idempotency key, per Resend's documented behaviour (keys kept
 * 24 hours). `invalid_idempotent_request`: the key already sent an email
 * with a different payload, so this message was delivered before (a durable
 * intent resent after a lapsed lease with fresh counts, ISSUE-655), and the
 * send succeeded with no new receipt. `concurrent_idempotent_requests`: the
 * first send is still in flight, which is transient. Anything else is a
 * permanent rejection.
 */
async function idempotencyConflict(response: Response): Promise<void> {
  const name = await response
    .json()
    .then((body: unknown) => (body as { name?: unknown } | null)?.name)
    .catch(() => undefined);
  if (name === 'invalid_idempotent_request') return;
  throw new DeliveryError(name === 'concurrent_idempotent_requests', 409);
}

/**
 * Resend transport behind the injected `send` seam. One user-requested link
 * is one operation: a single idempotency key, a total delivery deadline, and
 * at most one retry of a transient failure under that same key. Open/click
 * tracking is a Resend domain setting (documented for AUTH-1.3); the message
 * carries no tracked or third-party links.
 */
export function createResendSender({
  apiKey,
  from,
  ids,
  fetch: fetchImpl = fetch,
  timeoutMs = 10_000,
  elapsed = () => performance.now(),
}: {
  readonly apiKey: string;
  readonly from: string;
  readonly ids: IdGenerator;
  readonly fetch?: Fetch;
  readonly timeoutMs?: number;
  readonly elapsed?: () => number;
}): EmailSender {
  const attempt = async (
    message: EmailMessage,
    idempotencyKey: string,
    budgetMs: number,
  ) => {
    let response: Response;
    try {
      response = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
        signal: AbortSignal.timeout(budgetMs),
      });
    } catch {
      throw new DeliveryError(true);
    }
    if (response.status === 409) return idempotencyConflict(response);
    if (!response.ok)
      throw new DeliveryError(
        response.status === 429 || response.status >= 500,
        response.status,
      );
    let id: unknown;
    try {
      id = ((await response.json()) as { id?: unknown }).id;
    } catch {
      throw new DeliveryError(false, response.status);
    }
    if (typeof id !== 'string' || id.length === 0)
      throw new DeliveryError(false, response.status);
    return { providerMessageId: id };
  };
  return {
    async send(message) {
      const idempotencyKey = message.idempotencyKey ?? ids.next();
      const started = elapsed();
      const remaining = () => timeoutMs - (elapsed() - started);
      try {
        return await attempt(message, idempotencyKey, timeoutMs);
      } catch (error) {
        if (!(error instanceof DeliveryError) || !error.transient)
          throw new DeliveryError(false, (error as DeliveryError).status);
        const budget = Math.floor(remaining());
        if (budget < 1) throw error;
        try {
          return await attempt(message, idempotencyKey, budget);
        } catch (retryError) {
          if (error.uncertain && retryError instanceof DeliveryError)
            throw new DeliveryError(
              retryError.transient,
              retryError.status,
              true,
            );
          throw retryError;
        }
      }
    },
  };
}
