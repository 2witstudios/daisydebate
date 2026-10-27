import { assert, setupRitewayBun, test } from 'riteway/bun';
import { refuseCapacity } from '@daisy/db/testing';
import { createAppError } from '@daisy/errors';
import { handleOperation } from './http';
import { silentLogger } from './test-loggers.test-support';

setupRitewayBun();

const statusOf = async (error: unknown) =>
  (
    await handleOperation(
      silentLogger,
      new Request('http://localhost/x'),
      'op',
      async () => {
        throw error;
      },
    )
  ).status;

test('a capacity refusal maps to 503 only under an unminted wrapper', async () => {
  assert({
    given:
      'a refusal behind a driver wrapper, and a minted CONFLICT whose cause is a refusal',
    should: 'answer the retryable 503 for the wrapper and keep the minted 409',
    actual: [
      await statusOf(new Error('driver', { cause: refuseCapacity() })),
      await statusOf(createAppError('CONFLICT', 'stale', refuseCapacity())),
    ],
    expected: [503, 409],
  });
});

test('http.ts stays loadable in a browser bundle', async () => {
  const source = await Bun.file(new URL('./http.ts', import.meta.url)).text();
  assert({
    given:
      'server/http.ts, which client components reach through shared form parsing (ui/messaging/preference-form.tsx)',
    should:
      'never import the @daisy/db root, whose driver import (bun) breaks the browser chunk',
    actual: /from '@daisy\/db'/.test(source),
    expected: false,
  });
});
