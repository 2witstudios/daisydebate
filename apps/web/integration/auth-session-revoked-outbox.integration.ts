import { SQL } from 'bun';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createDatabase } from '@daisy/db';
import {
  capturedToken,
  createTestAuthServer,
  fixtureEmail,
  removeFixture,
  verifyUrl,
  type SentMessages,
} from './auth-helpers';
import type { RecordedLogs } from '../src/features/auth/log-leaks';

setupRitewayBun();

const url = process.env.TEST_DATABASE_URL;
if (!url)
  throw new Error(
    'TEST_DATABASE_URL required; never use application database for tests',
  );
if (!new URL(url).pathname.endsWith('_test'))
  throw new Error('Test database name must end in _test');

/**
 * RT-2.2 review finding (minor): a unit test can only prove the swallow
 * logic runs, not that it survives a real failure from the real
 * `appendOutboxEvent` path. This forces the outbox table itself away for
 * the duration of one real `/revoke-other-sessions` call — a genuine
 * Postgres-level failure of the exact statement `appendOutboxEvent` issues,
 * never a mock of the function under test — then restores it.
 */
const withOutboxHidden = async (work: () => Promise<void>) => {
  const admin = new SQL(url);
  try {
    await admin.unsafe('ALTER TABLE outbox RENAME TO outbox_forced_failure');
    await work();
  } finally {
    await admin.unsafe('ALTER TABLE outbox_forced_failure RENAME TO outbox');
    await admin.close();
  }
};

const signInOnce = async (
  auth: ReturnType<typeof createTestAuthServer>,
  email: string,
  sent: SentMessages,
) => {
  await auth.instance.api.signInMagicLink({
    body: { email },
    headers: new Headers({ origin: auth.config.PUBLIC_APP_URL }),
  });
  const token = capturedToken(sent.at(-1)!);
  const response = await auth.instance.handler(
    new Request(verifyUrl(token), {
      headers: new Headers({ origin: auth.config.PUBLIC_APP_URL }),
    }),
  );
  const body = (await response.json()) as { user: { id: string } };
  const cookie = response.headers.get('set-cookie')?.split(';')[0] ?? '';
  return { cookie, userId: body.user.id };
};

test('a forced outbox failure never fails a real /revoke-other-sessions call, and logs the registered event', async () => {
  const email = fixtureEmail();
  const sent: SentMessages = [];
  const logged: RecordedLogs = [];
  const database = createDatabase({ url });
  const auth = createTestAuthServer(database.authAdapter, {
    sent,
    recordedLogs: logged,
    appendSessionRevoked: (userId) => database.appendSessionRevoked(userId),
  });
  let userId: string | undefined;
  try {
    const first = await signInOnce(auth, email, sent);
    userId = first.userId;
    await signInOnce(auth, email, sent);

    let response: Response | undefined;
    await withOutboxHidden(async () => {
      response = await auth.instance.handler(
        new Request(
          `${auth.config.PUBLIC_APP_URL}/api/auth/revoke-other-sessions`,
          {
            method: 'POST',
            headers: new Headers({
              origin: auth.config.PUBLIC_APP_URL,
              cookie: first.cookie,
              'content-type': 'application/json',
            }),
            body: '{}',
          },
        ),
      );
    });

    const remaining = await new SQL(url).unsafe(
      'select token from session where user_id = $1',
      [userId],
    );

    assert({
      given:
        'a real /revoke-other-sessions call while the outbox table is unavailable',
      should:
        'still revoke the other session and answer success, logging the registered failure event instead of throwing',
      actual: {
        status: response?.status,
        remainingSessions: remaining.length,
        loggedAppendFailure: logged.some(
          ([event]) => event === 'realtime.outbox.append_failed',
        ),
      },
      expected: {
        status: 200,
        remainingSessions: 1,
        loggedAppendFailure: true,
      },
    });
  } finally {
    await database.close();
    await removeFixture(url, email, userId, []);
  }
});
