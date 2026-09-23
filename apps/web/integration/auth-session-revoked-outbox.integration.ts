import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createDatabase } from '@daisy/db';
import { buildUserInboxTopic } from '@daisy/protocol';
import {
  capturedToken,
  createTestAuthServer,
  fixtureEmail,
  removeFixture,
  verifyUrl,
  withOutboxInsertBlockedForTopic,
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
  const sessionResponse = await auth.instance.handler(
    new Request(
      `${auth.config.PUBLIC_APP_URL}/api/auth/get-session?disableCookieCache=true`,
      { headers: new Headers({ origin: auth.config.PUBLIC_APP_URL, cookie }) },
    ),
  );
  const sessionToken =
    ((await sessionResponse.json()) as { session?: { token: string } } | null)
      ?.session?.token ?? '';
  return { cookie, userId: body.user.id, sessionToken };
};

const sessionExists = async (admin: SQL, token: string): Promise<boolean> => {
  const rows = await admin.unsafe('select 1 from session where token = $1', [
    token,
  ]);
  return rows.length > 0;
};

/**
 * RT-2.2v nit: the repository's real-fault forced-failure proof previously
 * covered only `/revoke-other-sessions`. `/revoke-session` and
 * `/revoke-sessions` share the same `sessionRevokedOutboxPlugin` matcher
 * (`session-revoked-outbox.ts`) but only had unit proof. Parameterized over
 * all three real Better Auth endpoints.
 */
const routes: readonly {
  readonly path: string;
  readonly body: (secondToken: string) => string;
}[] = [
  { path: '/revoke-other-sessions', body: () => '{}' },
  { path: '/revoke-sessions', body: () => '{}' },
  {
    path: '/revoke-session',
    body: (secondToken) => JSON.stringify({ token: secondToken }),
  },
];

for (const route of routes) {
  test(`a forced outbox failure never fails a real ${route.path} call, and logs the registered event`, async () => {
    const email = fixtureEmail();
    const sent: SentMessages = [];
    const logged: RecordedLogs = [];
    const database = createDatabase({ url, nextActorId: createId });
    const auth = createTestAuthServer(database.authAdapter, {
      sent,
      recordedLogs: logged,
      appendSessionRevoked: (userId) => database.appendSessionRevoked(userId),
    });
    const admin = new SQL(url);
    let userId: string | undefined;
    try {
      const first = await signInOnce(auth, email, sent);
      userId = first.userId;
      const second = await signInOnce(auth, email, sent);
      const actorId = createId();
      // Plan revision 4.10: the append only runs once the actor resolves.
      // This test signs in without ever claiming a username, so it inserts
      // the actor directly rather than going through the onboarding route —
      // an unrelated surface to what this test proves.
      await admin.unsafe(
        "insert into actors (id, kind, user_id) values ($1, 'human', $2)",
        [actorId, userId],
      );

      let response: Response | undefined;
      await withOutboxInsertBlockedForTopic(
        url,
        buildUserInboxTopic(actorId),
        async () => {
          response = await auth.instance.handler(
            new Request(`${auth.config.PUBLIC_APP_URL}/api/auth${route.path}`, {
              method: 'POST',
              headers: new Headers({
                origin: auth.config.PUBLIC_APP_URL,
                cookie: first.cookie,
                'content-type': 'application/json',
              }),
              body: route.body(second.sessionToken),
            }),
          );
        },
      );

      const outboxRows = await admin.unsafe(
        'select 1 from outbox where topic = $1',
        [buildUserInboxTopic(actorId)],
      );

      assert({
        given: `a real ${route.path} call while its topic's outbox insert is forced to fail`,
        should:
          'still deny the target session and answer success, appending nothing and logging the registered failure event instead of throwing',
        actual: {
          status: response?.status,
          secondSessionDenied: !(await sessionExists(
            admin,
            second.sessionToken,
          )),
          outboxRowsAppended: outboxRows.length,
          loggedAppendFailure: logged.some(
            ([event]) => event === 'realtime.outbox.append_failed',
          ),
        },
        expected: {
          status: 200,
          secondSessionDenied: true,
          outboxRowsAppended: 0,
          loggedAppendFailure: true,
        },
      });
    } finally {
      await database.close();
      if (userId)
        await admin.unsafe('delete from actors where user_id = $1', [userId]);
      await admin.close();
      await removeFixture(url, email, userId, []);
    }
  });
}
