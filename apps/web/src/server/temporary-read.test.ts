import { assert, setupRitewayBun, test } from 'riteway/bun';
import { refuseCapacity } from '@daisy/db/testing';
import { createAppError } from '@daisy/errors';
import { handleOperation } from './http';
import {
  isTemporaryReadFailure,
  retrySeconds,
  unavailableRead,
  unreadable,
} from './temporary-read';
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

test('a page recovers only from a failure that is really temporary', () => {
  assert({
    given:
      'a thrown refusal, a wrapped one, and what the page throws for a temporary and an other read',
    should: 'recognise the temporary ones',
    actual: [
      refuseCapacity(),
      new Error('driver', { cause: refuseCapacity() }),
      unreadable({ temporary: true }),
      unreadable({}),
    ].map(isTemporaryReadFailure),
    expected: [true, true, true, false],
  });
  assert({
    given: "a Next redirect's control-flow error, a conflict and a stray value",
    should: 'leave each to whatever already owns it',
    actual: [
      Object.assign(new Error('NEXT_REDIRECT'), { digest: 'NEXT_REDIRECT;x' }),
      createAppError('CONFLICT'),
      'stray',
    ].map(isTemporaryReadFailure),
    expected: [false, false, false],
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
