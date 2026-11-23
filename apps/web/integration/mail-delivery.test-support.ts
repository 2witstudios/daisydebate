import { hostWaits } from '@daisy/worker/host';
import { z } from 'zod';
import { createId } from '@paralleldrive/cuid2';
import { createMailIntentDelivery } from '../src/features/beta-access/mail-delivery';
import { createResendSender } from '../src/features/mail/resend-sender';

type Db = import('@daisy/db').Database;

/** Real application worker and Resend adapter; its HTTP edge is a test provider. */
export function mailWorker(db: Db, ownerAddress?: string) {
  const keys: (string | null)[] = [];
  const sent: string[][] = [],
    failed: unknown[] = [];
  const sender = createResendSender({
    apiKey: 'test-provider-key',
    from: 'beta@example.test',
    nowMs: Date.now,
    waits: hostWaits,
    ids: { next: createId },
    fetch: async (_request, init) => {
      keys.push(new Headers(init?.headers).get('Idempotency-Key'));
      sent.push(
        z
          .object({ to: z.array(z.string()) })
          .parse(JSON.parse(String(init?.body))).to,
      );
      return Response.json({ id: createId() });
    },
  });
  return {
    sent,
    keys,
    failed,
    run: createMailIntentDelivery({
      store: db,
      deliver: async (message) => {
        await sender.send(message);
        return 'sent';
      },
      ownerAddress,
      appUrl: 'https://daisy.example',
      nextToken: () => createId() + createId(),
      now: () => new Date().toISOString(),
      failed: (error) => failed.push(error),
    }).run,
  };
}
