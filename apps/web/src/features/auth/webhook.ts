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

/** Monotonic status ranks: a late event can never lower a message's state. */
const RANKED: Record<
  string,
  readonly [string, number, DeliveryEvent['suppress']]
> = {
  'email.sent': ['sent', 1, null],
  'email.delivery_delayed': ['delayed', 2, null],
  'email.delivered': ['delivered', 3, null],
  'email.failed': ['failed', 4, null],
  'email.complained': ['complained', 6, 'complaint'],
};
const HARD_BOUNCE = ['bounced', 5, 'bounce'] as const;
const SOFT_BOUNCE = ['delayed', 2, null] as const;

/**
 * Only safe status is derived: the recipient list and any other payload
 * field is never read. Only permanent bounces and complaints suppress.
 */
export function classifyResendEvent(
  event: ProviderEvent,
): DeliveryEvent | null {
  const messageId = event.data?.email_id;
  if (typeof messageId !== 'string' || messageId.length === 0) return null;
  const bounce =
    event.data?.bounce?.type === 'Permanent' ? HARD_BOUNCE : SOFT_BOUNCE;
  const ranked = event.type === 'email.bounced' ? bounce : RANKED[event.type];
  if (!ranked) return null;
  const [status, rank, suppress] = ranked;
  return { status, rank, suppress, messageId };
}

const respond = (status: number, body: unknown, headers?: HeadersInit) =>
  Response.json(body, { status, ...(headers ? { headers } : {}) });
const rejected = () =>
  respond(400, { error: { code: 'VALIDATION', message: 'Invalid input' } });

/** Signatures cover the exact bytes: read the raw text once, bounded. */
async function readBoundedText(request: Request): Promise<string | null> {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES)
    return null;
  const payload = await request.text();
  return Buffer.byteLength(payload) > MAX_BODY_BYTES ? null : payload;
}

/**
 * Authenticates provider webhooks over the raw body with the official Resend
 * verifier (five-minute timestamp tolerance), deduplicates by event ID in
 * PostgreSQL and records only safe delivery status. Delivery events never
 * touch users, sessions or verification records: they cannot verify or change
 * ownership.
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
  const verify = async (request: Request) => {
    const id = request.headers.get('svix-id');
    const timestamp = request.headers.get('svix-timestamp');
    const signature = request.headers.get('svix-signature');
    if (!id || !timestamp || !signature) return null;
    const payload = await readBoundedText(request);
    if (payload === null) return null;
    try {
      const event = resend.webhooks.verify({
        payload,
        headers: { id, timestamp, signature },
        webhookSecret: secret,
      }) as unknown as ProviderEvent;
      return { id, event };
    } catch {
      return null;
    }
  };
  /** A racing event is retried by the provider once the send is recorded. */
  const unknownResponse = (event: ProviderEvent, at: string) => {
    const emitted = Date.parse(event.created_at ?? '');
    const recent =
      Number.isFinite(emitted) && Date.parse(at) - emitted < RACE_WINDOW_MS;
    return recent
      ? respond(503, { status: 'retry' }, { 'Retry-After': '5' })
      : respond(200, { status: 'ignored' });
  };
  return {
    async handle(request: Request): Promise<Response> {
      const verified = await verify(request);
      if (!verified) return rejected();
      const delivery = classifyResendEvent(verified.event);
      if (!delivery) return respond(200, { status: 'ignored' });
      const at = clock.now();
      const outcome = await apply({
        eventId: verified.id,
        providerMessageId: delivery.messageId,
        status: delivery.status,
        rank: delivery.rank,
        suppress: delivery.suppress,
        at,
      });
      return outcome === 'unknown-message'
        ? unknownResponse(verified.event, at)
        : respond(200, { status: outcome });
    },
  };
}
