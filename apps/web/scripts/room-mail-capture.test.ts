import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fixedIds } from '@daisy/clock';
import { createMailCapture } from '../e2e/support/mail-capture';

setupRitewayBun();

async function receiptsAcrossRestarts(
  ids?: Parameters<typeof createMailCapture>[0]['ids'],
) {
  const receipts: { id: string }[] = [];
  for (let instance = 0; instance < 2; instance++) {
    const capture = createMailCapture({
      port: 0,
      redisUrl: 'redis://localhost:6379/0',
      redisNamespace: 'unit-room-capture',
      ...(ids === undefined ? {} : { ids }),
    });
    try {
      const response = await capture.captureFetch(
        'https://api.resend.com/emails',
        {
          method: 'POST',
          body: JSON.stringify({
            to: ['room-capture@example.test'],
            subject: 'Fixture receipt',
            text: 'Test only',
            html: '<p>Test only</p>',
          }),
        },
      );
      receipts.push(await response.json());
    } finally {
      capture.stop(true);
    }
  }
  return receipts;
}

test('ROOM-6.1c capture restarts retain distinct injected receipt identities', async () => {
  assert({
    given: 'a fresh mail capture instance after the first server stopped',
    should: 'use the injected IDs rather than restart a per-process counter',
    actual: await receiptsAcrossRestarts(
      fixedIds(['receipt-first', 'receipt-after-restart']),
    ),
    expected: [{ id: 'receipt-first' }, { id: 'receipt-after-restart' }],
  });
});

test('ROOM-6.1c default capture IDs stay unique across server lifetimes', async () => {
  const receipts = await receiptsAcrossRestarts();
  assert({
    given:
      'two stopped-and-restarted capture servers using the default I/O factory',
    should: 'produce distinct cuid2 receipt IDs without resetting a counter',
    actual: {
      valid: receipts.every((receipt) =>
        /^[a-z][a-z0-9]{23}$/.test(receipt.id),
      ),
      distinct: new Set(receipts.map((receipt) => receipt.id)).size,
    },
    expected: { valid: true, distinct: 2 },
  });
});
