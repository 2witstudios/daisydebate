import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { buildUserInboxTopic } from '@daisy/protocol';
import { requireTestServices } from '@daisy/config';
import { createAuthRouteHandlers } from '../src/features/auth/handlers';
import { createSignOutFormHandler } from '../src/features/auth/sessions/sign-out-form';
import { createRecordingLogger } from '../src/server/test-loggers.test-support';
import {
  sessionExists,
  signInOnce,
  withOutboxInsertBlockedForTopic,
} from './auth-outbox-helpers';
import { createDatabaseAuthServer } from './auth-server-harness';
import { fixtureEmail, removeAccount } from './fixtures';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);

/**
 * The no-JS form (ISSUE-691) is a fifth session-deleting caller: through the
 * real route wrapper and the real `signOutFailsClosedPlugin`, a refused
 * delete returns the person to the form's page still signed in, never to
 * /sign-in with a cleared cookie (ISSUE-719).
 */
test('a real sign-out form post fails closed while its session.revoked control cannot commit', async () => {
  const email = fixtureEmail();
  const { sent, database, auth } = createDatabaseAuthServer(url);
  const admin = new SQL(url);
  const { logger, recorded } = createRecordingLogger();
  const form = createSignOutFormHandler({
    logger,
    origin: () => auth.config.PUBLIC_APP_URL,
    signOut: createAuthRouteHandlers(
      () => ({ handler: auth.instance.handler, config: auth.config }),
      logger,
    ).POST,
  });
  const post = (cookie: string) =>
    form(
      new Request(`${auth.config.PUBLIC_APP_URL}/auth/sign-out`, {
        method: 'POST',
        headers: new Headers({
          origin: auth.config.PUBLIC_APP_URL,
          cookie,
          'content-type': 'application/x-www-form-urlencoded',
        }),
        body: 'next=%2Fsettings%2Fsecurity',
      }),
    );
  let userId: string | undefined;
  try {
    const session = await signInOnce(auth, email, sent);
    userId = session.userId;
    const cookieName = session.cookie.split('=')[0]!;
    const actorId = createId();
    await admin.unsafe(
      "insert into actors (id, kind, user_id) values ($1, 'human', $2)",
      [actorId, userId],
    );
    const topic = buildUserInboxTopic(actorId);
    const [row] = await admin.unsafe(
      'select id from session where token = $1',
      [session.sessionToken],
    );
    const sessionId = (row as { id: string }).id;
    let blocked: Response | undefined;
    await withOutboxInsertBlockedForTopic(topic, async () => {
      blocked = await post(session.cookie);
    });
    const keptWhileBlocked = await sessionExists(admin, session.sessionToken);
    const controlsWhileBlocked = (
      await admin.unsafe('select 1 from outbox where topic = $1', [topic])
    ).length;
    const retried = await post(session.cookie);
    const controls = await admin.unsafe(
      'select payload from outbox where topic = $1',
      [topic],
    );
    const clearsSession = (response: Response | undefined) =>
      (response?.headers.getSetCookie() ?? []).some((cookie) =>
        cookie.startsWith(`${cookieName}=`),
      );
    assert({
      given:
        'a real form sign-out while its outbox insert is forced to fail, then the same form again',
      should:
        'return to the form page signed in with the notice and no control, then sign out to /sign-in with exactly one control',
      actual: {
        blocked: {
          status: blocked?.status,
          location: blocked?.headers.get('location'),
          clearsSession: clearsSession(blocked),
          keptWhileBlocked,
          controlsWhileBlocked,
          failureLogged: recorded.some(
            ({ event }) => event === 'auth.sign_out.failed',
          ),
        },
        retried: {
          status: retried.status,
          location: retried.headers.get('location'),
          clearsSession: clearsSession(retried),
          remaining: await sessionExists(admin, session.sessionToken),
          controls: controls.map(
            ({ payload }: { payload: { ids: string[] } }) => payload.ids,
          ),
        },
      },
      expected: {
        blocked: {
          status: 303,
          location: '/settings/security?signOut=failed',
          clearsSession: false,
          keptWhileBlocked: true,
          controlsWhileBlocked: 0,
          failureLogged: true,
        },
        retried: {
          status: 303,
          location: '/sign-in',
          clearsSession: true,
          remaining: false,
          controls: [[actorId, sessionId]],
        },
      },
    });
  } finally {
    await database.close();
    await admin.close();
    await removeAccount({ email, userId });
  }
});
