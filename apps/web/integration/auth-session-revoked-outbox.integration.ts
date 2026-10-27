import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { buildUserInboxTopic } from '@daisy/protocol';
import { withOutboxInsertBlockedForTopic } from './auth-outbox-helpers';
import { fixtureEmail, linkFrom, removeAccount, tokenOf } from './fixtures';
import {
  createDatabaseAuthServer,
  createTestAuthServer,
  redeemMagicLink,
  type SentMessages,
} from './auth-server-harness';
import { requireTestServices } from '@daisy/config';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);

const signInOnce = async (
  auth: ReturnType<typeof createTestAuthServer>,
  email: string,
  sent: SentMessages,
) => {
  await auth.instance.api.signInMagicLink({
    body: { email },
    headers: new Headers({ origin: auth.config.PUBLIC_APP_URL }),
  });
  const token = tokenOf(linkFrom(sent.at(-1)!));
  const response = await redeemMagicLink(auth, token);
  const cookie = response.headers.get('set-cookie')?.split(';')[0] ?? '';
  // Read on the server through auth.api: browser responses carry no session
  // token (ISSUE-63).
  const body = await auth.instance.api.getSession({
    headers: new Headers({ cookie }),
    query: { disableCookieCache: true },
  });
  return {
    cookie,
    userId: body?.user?.id ?? '',
    sessionToken: body?.session?.token ?? '',
  };
};

const sessionExists = async (admin: SQL, token: string): Promise<boolean> => {
  const rows = await admin.unsafe('select 1 from session where token = $1', [
    token,
  ]);
  return rows.length > 0;
};

/**
 * MSG-2.1-arch1 (G6): a real-fault proof for every route that deletes a
 * session. The `session.revoked` control is appended by the database's own
 * delete trigger in the deleting transaction, so a forced outbox failure
 * rolls the revocation back on every route, Better Auth's own sign-out and
 * `/revoke-session` included: the session survives with no control, and a
 * retry deletes it with exactly one. The revoke routes also surface the
 * outage; Better Auth 1.7.5's `/sign-out` instead logs the failed delete,
 * clears the cookie and answers 200 (ISSUE-719).
 */
const routes: readonly {
  readonly path: string;
  /** Which signed-in sessions the route deletes. */
  readonly deletes: readonly ('first' | 'second')[];
  readonly body: (secondToken: string) => string;
  /** Whether the caller sees the outage rather than a success. */
  readonly refusesOnFailure: boolean;
}[] = [
  {
    path: '/revoke-other-sessions',
    deletes: ['second'],
    body: () => '{}',
    refusesOnFailure: true,
  },
  {
    path: '/revoke-sessions',
    deletes: ['first', 'second'],
    body: () => '{}',
    refusesOnFailure: true,
  },
  {
    path: '/revoke-session',
    deletes: ['second'],
    body: (secondToken) => JSON.stringify({ token: secondToken }),
    refusesOnFailure: true,
  },
  {
    path: '/sign-out',
    deletes: ['first'],
    body: () => '{}',
    refusesOnFailure: false,
  },
];

const postRoute = (
  auth: ReturnType<typeof createTestAuthServer>,
  route: (typeof routes)[number],
  cookie: string,
  secondToken: string,
) =>
  auth.instance.handler(
    new Request(`${auth.config.PUBLIC_APP_URL}/api/auth${route.path}`, {
      method: 'POST',
      headers: new Headers({
        origin: auth.config.PUBLIC_APP_URL,
        cookie,
        'content-type': 'application/json',
      }),
      body: route.body(secondToken),
    }),
  );

for (const route of routes) {
  test(`a real ${route.path} call commits its session delete only with its session.revoked control`, async () => {
    const email = fixtureEmail();
    const { sent, database, auth } = createDatabaseAuthServer(url);
    const admin = new SQL(url);
    let userId: string | undefined;
    try {
      const first = await signInOnce(auth, email, sent);
      userId = first.userId;
      const second = await signInOnce(auth, email, sent);
      const targets = route.deletes.map((which) =>
        which === 'first' ? first : second,
      );
      const actorId = createId();
      // The control names the actor, so the account needs one; this test
      // never claims a username, so it inserts the actor directly.
      await admin.unsafe(
        "insert into actors (id, kind, user_id) values ($1, 'human', $2)",
        [actorId, userId],
      );
      const topic = buildUserInboxTopic(actorId);
      let failureCode: unknown;
      let blockedStatus: number | undefined;
      await withOutboxInsertBlockedForTopic(topic, async () => {
        blockedStatus = await postRoute(
          auth,
          route,
          first.cookie,
          second.sessionToken,
        )
          .then((response) => response.status)
          .catch((error: { code?: unknown }) => {
            failureCode = error.code;
            return undefined;
          });
      });
      const keptWhileBlocked = await Promise.all(
        targets.map(({ sessionToken }) => sessionExists(admin, sessionToken)),
      );
      // One lookup per token: Bun's unsafe() does not bind a JS array as a
      // PostgreSQL array parameter.
      const targetIds: string[] = (
        await Promise.all(
          targets.map(async ({ sessionToken }) => {
            const [row] = await admin.unsafe(
              'select id from session where token = $1',
              [sessionToken],
            );
            return (row as { id: string }).id;
          }),
        )
      ).sort();
      const status = (
        await postRoute(auth, route, first.cookie, second.sessionToken)
      ).status;
      const controls = await admin.unsafe(
        'select payload from outbox where topic = $1',
        [topic],
      );
      assert({
        given: `a real ${route.path} call while its outbox insert is forced to fail, then the same call again`,
        should:
          'keep the session with no control the first time, then delete it with exactly one control naming the actor and that session',
        actual: {
          // Refused either as a thrown INFRASTRUCTURE or as a 5xx answer.
          refused:
            blockedStatus === undefined
              ? failureCode === 'INFRASTRUCTURE'
              : blockedStatus >= 500,
          keptWhileBlocked,
          status,
          remaining: (
            await Promise.all(
              targets.map(({ sessionToken }) =>
                sessionExists(admin, sessionToken),
              ),
            )
          ).filter(Boolean).length,
          controls: controls
            .map(({ payload }: { payload: { ids: string[] } }) => payload.ids)
            .sort((a: string[], b: string[]) => a[1]!.localeCompare(b[1]!)),
        },
        expected: {
          refused: route.refusesOnFailure,
          keptWhileBlocked: targets.map(() => true),
          status: 200,
          remaining: 0,
          controls: targetIds.map((id) => [actorId, id]),
        },
      });
    } finally {
      await database.close();
      await admin.close();
      await removeAccount({ email, userId });
    }
  });
}

const insertOutboxRow = (admin: SQL, topic: string) =>
  admin
    .unsafe(
      "insert into outbox (topic, kind, version, payload) values ($1, 'test.scope-check', 1, '{}'::jsonb)",
      [topic],
    )
    .then(() => 'accepted')
    .catch(() => 'refused');

/**
 * RT-2.2f-r1 minor: nothing enforced that `withOutboxInsertBlockedForTopic`'s
 * `BEFORE INSERT` trigger only rejects its own topic — if the `if new.topic
 * = …` guard were ever dropped, every other test using the helper would
 * still pass (they only insert on their own already-blocked topic), and
 * nothing would notice.
 */
test('withOutboxInsertBlockedForTopic blocks only its own topic, never an unrelated one', async () => {
  const admin = new SQL(url);
  const blockedTopic = `test:scope-check:${createId()}`;
  const otherTopic = `test:scope-check:${createId()}`;
  try {
    let blockedAttempt = '';
    let otherAttempt = '';
    await withOutboxInsertBlockedForTopic(blockedTopic, async () => {
      blockedAttempt = await insertOutboxRow(admin, blockedTopic);
      otherAttempt = await insertOutboxRow(admin, otherTopic);
    });
    assert({
      given: "a BEFORE INSERT trigger held for one fixture's own topic",
      should:
        'refuse an insert on that exact topic while an insert on an unrelated topic still succeeds',
      actual: { blockedAttempt, otherAttempt },
      expected: { blockedAttempt: 'refused', otherAttempt: 'accepted' },
    });
  } finally {
    await admin.unsafe('delete from outbox where topic = $1', [otherTopic]);
    await admin.close();
  }
});
