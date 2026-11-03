import { assert, setupRitewayBun, test } from 'riteway/bun';
import { refuseCapacity } from '@daisy/db/testing';
import { createAppError } from '@daisy/errors';
import { handleOperation, requireSignedIn } from './http';
import { silentLogger } from './test-loggers.test-support';

setupRitewayBun();

const statusOf = async (error: unknown) =>
  (
    await handleOperation(
      silentLogger,
      new Request('http://localhost/x'),
      'health.readiness',
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

test('a route read behind a refused identity says when to retry', async () => {
  const answer = (identity: Parameters<typeof requireSignedIn>[0]) =>
    handleOperation(
      silentLogger,
      new Request('http://localhost/x'),
      'health.readiness',
      async () => {
        requireSignedIn(identity);
        return new Response();
      },
    );
  const principal = { kind: 'anonymous' } as const;
  const refused = await answer({
    state: 'unavailable',
    principal,
    temporary: true,
  });
  const failed = await answer({ state: 'unavailable', principal });
  assert({
    given: 'an identity unavailable by refusal, and one unavailable otherwise',
    should: 'answer 503 for both and advise a retry only for the refusal',
    actual: [
      [refused.status, refused.headers.has('retry-after')],
      [failed.status, failed.headers.has('retry-after')],
    ],
    expected: [
      [503, true],
      [503, false],
    ],
  });
});
