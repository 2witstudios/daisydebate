import { afterAll, expect, test } from 'bun:test';
import { createId } from '@paralleldrive/cuid2';
import type { Identity } from '@daisy/auth';
import { createPasskeyFlows } from './auth-passkey-flows';
import { testDatabaseUrl, withSql } from './auth-mounted-helpers';

/**
 * AUTH-6.2: proves a running app survives a migration re-application and a
 * resource restart without losing live auth state (session, passkey,
 * debate ownership). `bun verify` already proves migrations are idempotent
 * against an empty database; this proves an *upgrade over live data* keeps
 * that data intact and the still-running app keeps serving it correctly.
 */
if (!process.env.TEST_DATABASE_URL || !process.env.TEST_REDIS_URL)
  throw new Error('TEST_DATABASE_URL and TEST_REDIS_URL are required');

const flows = await createPasskeyFlows();
const { signUp, identifyAs } = flows.account;

const userIdOf = (identity: Identity): string =>
  identity.state === 'member' || identity.state === 'provisional'
    ? identity.principal.userId
    : (() => {
        throw new Error('expected an authenticated identity');
      })();

const passkeyCount = (userId: string) =>
  withSql(async (sql) => {
    const [row] =
      await sql`SELECT count(*)::int AS c FROM passkey WHERE user_id = ${userId}`;
    return (row?.c as number) ?? 0;
  });

const debateOwner = (debateId: string) =>
  withSql(async (sql) => {
    const [row] = await sql`
      SELECT a.user_id AS "userId", d.phase AS phase
      FROM debates d JOIN actors a ON a.id = d.created_by
      WHERE d.id = ${debateId}
    `;
    return row as { userId: string; phase: string } | undefined;
  });

test('a migration re-application and a resource restart preserve a live session, passkey and debate ownership', async () => {
  const { email, cookie } = await signUp();
  await flows.enrollPasskey(cookie, { name: 'Restart laptop' });

  const before = await identifyAs(cookie);
  const userId = userIdOf(before);

  const actorId = `actr${createId().slice(0, 20)}`;
  const debateId = `dbte${createId().slice(0, 20)}`;
  await withSql(async (sql) => {
    await sql`INSERT INTO actors (id, kind, user_id) VALUES (${actorId}, 'human', ${userId})`;
    await sql`
      INSERT INTO debates (id, created_by, resolution, format, snapshot, mode, phase, visibility)
      VALUES (${debateId}, ${actorId}, 'Restart-survival proof', 'foundation', '{}'::jsonb, 'casual', 'waiting', 'public')
    `;
  });

  afterAll(() =>
    withSql(async (sql) => {
      await sql`DELETE FROM debates WHERE id = ${debateId}`;
      await sql`DELETE FROM actors WHERE id = ${actorId}`;
    }),
  );

  const beforePasskeys = await passkeyCount(userId);
  const beforeOwner = await debateOwner(debateId);

  // "Migration upgrade": re-apply the already-applied migration journal to
  // the live, populated test database via the real migration script — the
  // same script production runs before a deploy restarts the app.
  const migrated = Bun.spawnSync(['bun', 'packages/db/scripts/migrate.ts'], {
    env: { ...process.env, DATABASE_URL: testDatabaseUrl },
    cwd: `${import.meta.dir}/../../..`,
  });
  expect(migrated.exitCode).toBe(0);

  // "Application restart": drop the process-wide connection pools and the
  // cached Better Auth instance built on top of them, so the next call
  // rebuilds everything from scratch, exactly as a fresh process would.
  const { closeResources, getResources } =
    await import('../src/server/resources');
  await closeResources();
  const state = globalThis as Record<string, unknown>;
  for (const key of ['daisyResources', 'daisyAuth', 'daisyMailWebhook'])
    Reflect.deleteProperty(state, key);
  getResources();

  const after = await identifyAs(cookie);
  const afterPasskeys = await passkeyCount(userId);
  const afterOwner = await debateOwner(debateId);

  expect({
    identity: after.state,
    userId: userIdOf(after),
    passkeys: afterPasskeys,
    owner: afterOwner,
  }).toEqual({
    identity: before.state,
    userId,
    passkeys: beforePasskeys,
    owner: beforeOwner,
  });
  expect(afterPasskeys).toBeGreaterThan(0);
  expect(afterOwner?.userId).toBe(userId);

  void email;
});
