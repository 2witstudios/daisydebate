import { expect } from '@playwright/test';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  completedMessagingOperations,
  awaitMessagingOperations,
} from '../e2e/support/messaging-completed-operations';
setupRitewayBun();

const boundary = {
  since: 100,
  requestIds: ['first', 'held'],
  operation: 'messaging.history',
};
const completed = (requestId: string, status = 503, time = 150) =>
  JSON.stringify({
    requestId,
    operation: 'messaging.history',
    event: status === 200 ? 'http.request.completed' : 'http.request.failed',
    time,
    durationMs: 10,
    status,
    errorCode: status === 503 ? 'INFRASTRUCTURE' : 'INTERNAL',
  }) + '\n';
const summary = (
  requestId: string,
  operation = 'messaging.history',
  cause = 'social.expired',
  time = 140,
) =>
  JSON.stringify({
    requestId,
    event: 'db.capacity.refused',
    operation,
    time,
    cause,
  }) + '\n';

test('completed operation visibility excludes unrelated requests, phases and partial lines', () => {
  const source =
    completed('unrelated') +
    completed('first', 503, 99) +
    completed('first').replace('messaging.history', 'messaging.channel.entry') +
    summary('first', 'messaging.channel.entry') +
    summary('first') +
    completed('first') +
    '{"requestId":"held"';
  assert({
    given:
      'old, unrelated, other-operation and incomplete records beside one current completion',
    should:
      'require each corresponding response identity rather than an aggregate operation count',
    actual: completedMessagingOperations(source, boundary),
    expected: [
      {
        requestId: 'first',
        status: 503,
        errorCode: 'INFRASTRUCTURE',
        admission: 'social.expired',
      },
    ],
  });
});

test('delayed log visibility awaits records without selecting a desired status', async () => {
  let reads = 0;
  const records = await awaitMessagingOperations(async () => {
    reads += 1;
    return reads === 1
      ? completed('unrelated')
      : summary('first') + completed('first') + completed('held', 500);
  }, boundary);
  let wrongStatusRejected = false;
  try {
    expect(records.every((record) => record.status === 503)).toBe(true);
  } catch {
    wrongStatusRejected = true;
  }
  assert({
    given:
      'the corresponding log writes arrive after the response, including an INTERNAL500',
    should:
      'await visibility and expose the wrong status immediately for a later exact assertion',
    actual: {
      reads,
      statuses: records.map((record) => record.status),
      wrongStatusRejected,
    },
    expected: { reads: 2, statuses: [503, 500], wrongStatusRejected: true },
  });
});

test('a missing corresponding completion fails within the existing assertion budget', async () => {
  let failed = false;
  try {
    await awaitMessagingOperations(
      async () =>
        completed('first') + completed('first') + completed('unrelated'),
      boundary,
    );
  } catch {
    failed = true;
  }
  assert({
    given:
      'one response never has a completion while unrelated completions are visible',
    should:
      'fail the bounded visibility precondition instead of certifying missing evidence',
    actual: failed,
    expected: true,
  });
}, 10000);

test('admission cause belongs to the completed operation interval', () => {
  const source =
    summary('first', 'messaging.channel.entry') +
    summary('first', 'messaging.history', 'social.expired', 90) +
    summary('first', 'messaging.history', 'social.expired', 151) +
    summary('first', 'messaging.history', 'social.saturated') +
    completed('first') +
    summary('held', 'messaging.channel.entry') +
    completed('held');
  assert({
    given:
      'one document ID has entry expiry, old/future history expiry and current history saturation',
    should:
      'preserve the exact own saturated cause and never borrow entry expiry for an unconfigured history result',
    actual: completedMessagingOperations(source, boundary).map(
      (record) => record.admission,
    ),
    expected: ['social.saturated', null],
  });
});
