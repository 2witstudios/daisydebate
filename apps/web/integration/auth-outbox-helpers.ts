import { createId } from '@paralleldrive/cuid2';
import { buildUserInboxTopic } from '@daisy/protocol';
import { SQL } from 'bun';
import { linkFrom, testDatabaseUrl, tokenOf, withSql } from './fixtures';
import {
  redeemMagicLink,
  type createTestAuthServer,
  type SentMessages,
} from './auth-server-harness';

/**
 * RT-2.2: shared fixtures for suites that assert an auth operation appends a
 * `session.revoked` outbox row for the acting user's actor.
 *
 * Plan revision 4.10: the outbox append only runs once the actor resolves
 * through `actors.user_id`. ACTOR-1 creates that row during real username
 * onboarding, but these suites sign up without ever claiming a username (an
 * unrelated surface to session revocation/email-change), so `createActorFor`
 * inserts the actor directly rather than going through the onboarding route.
 * Revocation rows are keyed by `actors.id`, never `userId`.
 */
const createActorFor = async (userId: string): Promise<string> => {
  const actorId = createId();
  await withSql(
    (sql) =>
      sql`INSERT INTO actors (id, kind, user_id) VALUES (${actorId}, 'human', ${userId})`,
  );
  return actorId;
};

const cleanupActorFor = (userId: string) =>
  withSql((sql) => sql`DELETE FROM actors WHERE user_id = ${userId}`);

/** Outbox rows a `session.revoked`-emitting operation appended for this actor. */
const sessionRevokedEvents = (actorId: string) =>
  withSql(
    (sql) =>
      sql`SELECT topic FROM outbox WHERE kind = 'session.revoked' AND topic = ${buildUserInboxTopic(actorId)}`,
  ).then((rows) => rows.length);

const cleanupOutboxFor = (actorId: string) =>
  withSql(
    (sql) =>
      sql`DELETE FROM outbox WHERE kind = 'session.revoked' AND topic = ${buildUserInboxTopic(actorId)}`,
  );

/**
 * Forces one genuine Postgres-level `appendOutboxEvent` failure (RT-2.2v
 * minor 3), scoped to exactly one topic: a `BEFORE INSERT` trigger that
 * raises only for that topic's rows, dropped again once `work` settles.
 * Renaming the shared `outbox` table away for the duration of `work` would
 * fail every unrelated insert and drain and hold an ACCESS EXCLUSIVE lock
 * for that whole window; a topic-scoped trigger rejects only inserts naming
 * this fixture's own topic. Its `CREATE`/`DROP TRIGGER` still queue behind
 * every open transaction that wrote `outbox`, and every later insert queues
 * behind them, which is why the root `test:integration` runs one
 * workspace at a time (ISSUE-61, ISSUE-100). Two real consumers:
 * `auth-session-revoked-outbox.integration.ts` and
 * `auth-email-change-atomicity.integration.ts`.
 */
export const withOutboxInsertBlockedForTopic = async (
  topic: string,
  work: () => Promise<void>,
) => {
  const admin = new SQL(testDatabaseUrl);
  const name = `outbox_force_failure_${createId()}`;
  const escapedTopic = topic.replace(/'/g, "''");
  try {
    await admin.unsafe(`
      create function "${name}"() returns trigger as $body$
      begin
        if new.topic = '${escapedTopic}' then
          raise exception 'forced outbox failure for topic % (fixture-scoped)', new.topic;
        end if;
        return new;
      end;
      $body$ language plpgsql
    `);
    await admin.unsafe(`
      create trigger "${name}_trigger" before insert on outbox
      for each row execute function "${name}"()
    `);
    await work();
  } finally {
    await admin.unsafe(`drop trigger if exists "${name}_trigger" on outbox`);
    await admin.unsafe(`drop function if exists "${name}"()`);
    await admin.close();
  }
};

/**
 * Gives a user a human actor and counts the `session.revoked` rows appended
 * for it from now on; `cleanup` removes those rows and the actor again.
 */
export const trackRevocations = async (userId: string) => {
  const actorId = await createActorFor(userId);
  const before = await sessionRevokedEvents(actorId);
  return {
    actorId,
    appended: async () => (await sessionRevokedEvents(actorId)) - before,
    cleanup: async () => {
      await cleanupOutboxFor(actorId);
      await cleanupActorFor(userId);
    },
  };
};

/** One real magic-link sign-in: its cookie, user id and session token. */
export const signInOnce = async (
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

export const sessionExists = async (
  admin: SQL,
  token: string,
): Promise<boolean> => {
  const rows = await admin.unsafe('select 1 from session where token = $1', [
    token,
  ]);
  return rows.length > 0;
};
