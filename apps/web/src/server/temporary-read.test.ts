import { assert, setupRitewayBun, test } from 'riteway/bun';
import { refuseCapacity } from '@daisy/db/testing';
import { createAppError } from '@daisy/errors';
import { handleOperation } from './http';
import { retrySeconds, unavailableRead } from './temporary-read';
import { silentLogger } from './test-loggers.test-support';

setupRitewayBun();

const answerTo = (error: unknown) =>
  handleOperation(
    silentLogger,
    new Request('http://localhost/x'),
    'op',
    async () => {
      throw error;
    },
  );

test('a read answer is temporary only when the route says asking again can help', async () => {
  assert({
    given:
      'a real refusal, a minted outage, a rate limit, a refused wrapper with a minted conflict, and a stray failure',
    should: 'mark only the refusal and the rate limit temporary',
    actual: [
      unavailableRead(await answerTo(refuseCapacity())),
      unavailableRead(await answerTo(createAppError('INFRASTRUCTURE'))),
      unavailableRead(await answerTo(createAppError('RATE_LIMIT'))),
      unavailableRead(
        await answerTo(createAppError('CONFLICT', 'stale', refuseCapacity())),
      ),
      unavailableRead(await answerTo(new Error('bug'))),
    ],
    expected: [
      { kind: 'unavailable', temporary: true },
      { kind: 'unavailable' },
      { kind: 'unavailable', temporary: true },
      { kind: 'unavailable' },
      { kind: 'unavailable' },
    ],
  });
});

test('pages refused together spread their return above a fixed floor', () => {
  const seconds = Array.from({ length: 256 }, (_, byte) => retrySeconds(byte));
  assert({
    given: 'every possible random byte',
    should: 'answer whole seconds from 2 to 4, each of them reachable',
    actual: [...new Set(seconds)].sort(),
    expected: [2, 3, 4],
  });
});
