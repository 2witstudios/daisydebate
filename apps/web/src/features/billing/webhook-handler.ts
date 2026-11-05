import type { BillingConfig } from '@daisy/config';
import type { Clock } from '@daisy/clock';
import type { Database } from '@daisy/db';
import { readBoundedBody } from '../../server/bounded-body';
import { verifyBillingWebhook } from './webhook-verification';

/** A 2xx means the verified hint is durable (or irrelevant), never that access was granted. */
export function createBillingWebhook(input: {
  readonly config: BillingConfig;
  readonly clock: Clock;
  readonly deadline: () => AbortSignal;
  readonly receive: Database['receiveBillingReceipt'];
  readonly failed: () => void;
}) {
  return async (request: Request): Promise<Response> => {
    if (input.config.kind === 'disabled')
      return new Response(null, { status: 404 });
    const signature = request.headers.get('stripe-signature');
    if (!signature || signature.length > 4096)
      return new Response(null, { status: 400 });
    const body = await readBoundedBody(
      request,
      256 * 1024,
      input.deadline(),
    ).catch(() => null);
    if (body === null) return new Response(null, { status: 400 });
    const verified = await verifyBillingWebhook({
      body,
      signature,
      secret: input.config.webhookSecret,
      mode: input.config.mode,
      receivedAt: Date.parse(input.clock.now()),
    });
    if (verified.kind !== 'accepted')
      return new Response(null, {
        status: verified.kind === 'rejected' ? 400 : 204,
      });
    try {
      await input.receive({
        eventId: verified.hint.eventId,
        ...('refund' in verified.hint
          ? { refund: verified.hint.refund }
          : { customerId: verified.hint.customerId }),
        mode: input.config.mode,
      });
      return new Response(null, { status: 204 });
    } catch {
      // Database/SDK errors can carry private values. This boundary emits only a failure count.
      input.failed();
      return new Response(null, {
        status: 503,
        headers: { 'Retry-After': '5' },
      });
    }
  };
}
