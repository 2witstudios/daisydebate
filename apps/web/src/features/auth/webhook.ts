import { Resend } from 'resend';
import type { Clock } from '@daisy/clock';

const MAX_BODY_BYTES = 64 * 1024;
/** A just-sent message can be reported before its send is recorded. */
const RACE_WINDOW_MS = 120_000;

type ProviderEvent = {
  readonly type: string;
  readonly created_at?: string;
  readonly data?: {
    readonly email_id?: unknown;
    readonly bounce?: { readonly type?: unknown };
  };
};
export type DeliveryEvent = {
  readonly status: string;
  readonly rank: number;
  readonly suppress: 'bounce' | 'complaint' | null;
  readonly messageId: string;
};
type ApplyInput = {
  readonly eventId: string;
  readonly providerMessageId: string;
  readonly status: string;
  readonly rank: number;
  readonly suppress: 'bounce' | 'complaint' | null;
  readonly at: string;
};

/**
 * Only safe status is derived: the recipient list and any other payload
 * field is never read. Ranks are monotonic so an out-of-order event cannot
 * lower a message's state; only permanent bounces and complaints suppress.
 */
export function classifyResendEvent(
  event: ProviderEvent,
): DeliveryEvent | null {
  const messageId = event.data?.email_id;
  if (typeof messageId !== 'string' || messageId.length === 0) return null;
  const result = (
    status: string,
    rank: number,
    suppress: DeliveryEvent['suppress'] = null,
  ): DeliveryEvent => ({ status, rank, suppress, messageId });
  switch (event.type) {
    case 'email.sent':
      return result('sent', 1);
    case 'email.delivery_delayed':
      return result('delayed', 2);
    case 'email.delivered':
      return result('delivered', 3);
    case 'email.failed':
      return result('failed', 4);
    case 'email.bounced':
      return event.data?.bounce?.type === 'Permanent'
        ? result('bounced', 5, 'bounce')
        : result('delayed', 2);
    case 'email.complained':
      return result('complained', 6, 'complaint');
    default:
      return null;
  }
}

const respond = (status: number, body: unknown, headers?: HeadersInit) =>
  Response.json(body, { status, ...(headers ? { headers } : {}) });
const rejected = () =>
  respond(400, {
    error: { code: 'VALIDATION', message: 'Invalid input' },
  });

/**
 * Authenticates provider webhooks over the raw body with the official Resend
 * verifier (five-minute timestamp tolerance), deduplicates by event ID and
 * records only safe delivery status. Delivery events never touch users,
 * sessions or verification records: they cannot verify or change ownership.
 */
export function createResendWebhook({
  secret,
  apiKey,
  clock,
  apply,
}: {
  readonly secret: string;
  readonly apiKey: string;
  readonly clock: Clock;
  readonly apply: (
    input: ApplyInput,
  ) => Promise<'applied' | 'duplicate' | 'unknown-message'>;
}) {
  const resend = new Resend(apiKey);
  return {
    async handle(request: Request): Promise<Response> {
      const id = request.headers.get('svix-id');
      const timestamp = request.headers.get('svix-timestamp');
      const signature = request.headers.get('svix-signature');
      if (!id || !timestamp || !signature) return rejected();
      const declared = Number(request.headers.get('content-length') ?? 0);
      if (declared > MAX_BODY_BYTES) return rejected();
      // Signatures cover the exact bytes: read text once, never re-serialize.
      const payload = await request.text();
      if (Buffer.byteLength(payload) > MAX_BODY_BYTES) return rejected();
      let event: ProviderEvent;
      try {
        event = resend.webhooks.verify({
          payload,
          headers: { id, timestamp, signature },
          webhookSecret: secret,
        }) as unknown as ProviderEvent;
      } catch {
        return rejected();
      }
      const delivery = classifyResendEvent(event);
      if (!delivery) return respond(200, { status: 'ignored' });
      const at = clock.now();
      const outcome = await apply({
        eventId: id,
        providerMessageId: delivery.messageId,
        status: delivery.status,
        rank: delivery.rank,
        suppress: delivery.suppress,
        at,
      });
      if (outcome !== 'unknown-message')
        return respond(200, { status: outcome });
      const emitted = Date.parse(event.created_at ?? '');
      const recent =
        Number.isFinite(emitted) && Date.parse(at) - emitted < RACE_WINDOW_MS;
      // A racing event is retried by the provider once the send is recorded;
      // an old one is for a message this system never sent.
      return recent
        ? respond(503, { status: 'retry' }, { 'Retry-After': '5' })
        : respond(200, { status: 'ignored' });
    },
  };
}
