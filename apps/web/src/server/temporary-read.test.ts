import { assert, setupRitewayBun, test } from 'riteway/bun';
import { refuseCapacity } from '@daisy/db/testing';
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

test('a read answer is temporary only when the route says it refused work that never ran', async () => {
  assert({
    given: 'a real refusal, a stray failure and a malformed answer',
    should: 'mark only the refusal temporary',
    actual: [
      unavailableRead(await answerTo(refuseCapacity())),
      unavailableRead(await answerTo(new Error('bug'))),
      unavailableRead(),
    ],
    expected: [
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
