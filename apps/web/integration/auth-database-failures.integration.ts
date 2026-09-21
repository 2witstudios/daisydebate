import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { isAppError } from '@daisy/errors';
import { createDatabase } from '@daisy/db';
import {
  countFixtureRows,
  createTestAuthServer,
  emptyCounts,
  fixtureEmail,
  removeFixture,
} from './auth-helpers';

setupRitewayBun();

const url = process.env.TEST_DATABASE_URL;
if (!url)
  throw new Error(
    'TEST_DATABASE_URL required; never use application database for tests',
  );
if (!new URL(url).pathname.endsWith('_test'))
  throw new Error('Test database name must end in _test');

type ReportedFailure = { event: string; fields: unknown; message: string };

test('delivery failure surfaces a safe retryable error and cleanup still leaves no fixture rows', async () => {
  const email = fixtureEmail();
  const sent: import('./auth-helpers').SentMessages = [];
  const database = createDatabase({ url });
  const auth = createTestAuthServer(database.authAdapter, {
    sent,
    deliveryFailure: new Error('resend unavailable'),
  });
  try {
    let caught: unknown;
    try {
      await auth.instance.api.signInMagicLink({
        body: { email },
        headers: new Headers({ origin: auth.config.PUBLIC_APP_URL }),
      });
    } catch (error) {
      caught = error;
    }
    assert({
      given: 'an email delivery failure during a magic-link request',
      should:
        'surface a safe retryable infrastructure error without leaking the cause',
      actual: {
        appError: isAppError(caught),
        code: isAppError(caught) ? caught.code : undefined,
        leaks:
          caught !== undefined && String(caught).includes('resend unavailable'),
      },
      expected: { appError: true, code: 'INFRASTRUCTURE', leaks: false },
    });
  } finally {
    await database.close();
    // No user id exists on this failed path; verification rows may exist.
    await removeFixture(url, email, undefined, []);
  }

  assert({
    given: 'the bounded fixture cleanup after the failed request',
    should: 'leave no verification or user fixture records behind',
    actual: await countFixtureRows(url, email, undefined),
    expected: emptyCounts,
  });
});

test('pool lifecycle closes and the app failure boundary reports without SQL material', async () => {
  const failures: ReportedFailure[] = [];
  const database = createDatabase({
    url,
    maxConnections: 1,
    eventSink: (event, fields, message) =>
      failures.push({ event, fields, message }),
  });
  // The raw driver error embeds SQL and bound parameters; the app-owned
  // boundary must report only safe operation names.
  let foreignKeyRejected = false;
  try {
    await database.createDebate({
      id: createId(),
      createdBy: createId(),
      resolution: 'Orphan debate',
      format: 'foundation',
      snapshot: {},
    });
  } catch {
    foreignKeyRejected = true;
  }
  const reportedAfterOperation = [...failures];
  const healthy = await database.health();
  await database.close();
  let closed = false;
  try {
    await database.health();
  } catch {
    closed = true;
  }

  assert({
    given: 'the shared database pool',
    should: 'report health while open and fail after the lifecycle close',
    actual: { healthy, closed },
    expected: { healthy: true, closed: true },
  });
  assert({
    given: 'a driver failure inside an application database operation',
    should:
      'reject and report only safe operation names, never SQL or parameters',
    actual: {
      foreignKeyRejected,
      reported: reportedAfterOperation.map(({ event, fields, message }) => ({
        event,
        fields,
        message,
      })),
    },
    expected: {
      foreignKeyRejected: true,
      reported: [
        {
          event: 'db.query.failed',
          fields: { operation: 'createDebate' },
          message: 'Database query failed',
        },
      ],
    },
  });
});
