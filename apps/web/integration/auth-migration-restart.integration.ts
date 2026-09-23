import { afterAll } from 'bun:test';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { Identity } from '@daisy/auth';
import { systemClock, systemId } from '@daisy/clock';
import { createPasskeyFlows } from './auth-passkey-flows';
import { counts, removeAccount, testDatabaseUrl, withSql } from './fixtures';
import { CLIENT_IP_HEADER } from '../src/features/auth/client-ip';
import { identify } from '../src/lib/identity';
import { createApp } from '../src/server/app';
import { requireTestServices } from '@daisy/config';

/**
 * AUTH-6.2: proves a running app survives a migration re-application and a
 * resource restart without losing live auth state (session, passkey,
 * debate ownership). `bun verify` already proves migrations are idempotent
 * against an empty database; this proves an *upgrade over live data* keeps
 * that data intact and the still-running app keeps serving it correctly.
 */
requireTestServices(process.env);
setupRitewayBun();

const flows = await createPasskeyFlows();
const { signUp, identifyAs } = flows.account;

const userIdOf = (identity: Identity): string =>
  identity.state === 'member' || identity.state === 'provisional'
    ? identity.principal.userId
    : (() => {
        throw new Error('expected an authenticated identity');
      })();

const debateOwner = (debateId: string) =>
  withSql(async (sql) => {
    const [row] = await sql`
      SELECT a.user_id AS "userId", d.phase AS phase
      FROM debates d JOIN actors a ON a.id = d.created_by_actor_id
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
      INSERT INTO debates (id, created_by_actor_id, resolution, format_id, snapshot, mode, phase, visibility)
      VALUES (${debateId}, ${actorId}, 'Restart-survival proof', 'foundation', '{}'::jsonb, 'casual', 'waiting', 'public')
    `;
  });

  // ISSUE-20: the debate holds the actor, which holds the user (both
  // RESTRICT), so this suite removes all three itself, the account keyed by
  // the user id signUp() created, leaving nothing for a later run to count.
  afterAll(async () => {
    await withSql(async (sql) => {
      await sql`DELETE FROM debates WHERE id = ${debateId}`;
      await sql`DELETE FROM actors WHERE id = ${actorId}`;
    });
    await removeAccount({ email, userId });
  });

  const beforePasskeys = (await counts({ userId })).passkeys;
  const beforeOwner = await debateOwner(debateId);

  // "Migration upgrade": re-apply the already-applied migrations to
  // the live, populated test database via the real migration script — the
  // same script production runs before a deploy restarts the app.
  const migrated = Bun.spawnSync(['bun', 'packages/db/scripts/migrate.ts'], {
    env: { ...process.env, DATABASE_URL: testDatabaseUrl },
    cwd: `${import.meta.dir}/../../..`,
  });
  const migrationExit = migrated.exitCode;

  // "Application restart": close the running app's pools, then build a new
  // app from the same environment and read the session through it, exactly
  // as a fresh process would.
  const { testApp } = flows.account.flows;
  await testApp.app.close();
  const restarted = createApp({
    env: testApp.env,
    fetch: testApp.mailbox.fetch,
    clock: systemClock,
    ids: systemId,
  });
  afterAll(() => restarted.close());

  const after = await identify(
    restarted.auth(),
    new Headers({ cookie, [CLIENT_IP_HEADER]: testApp.newClient() }),
  );
  const afterPasskeys = (await counts({ userId })).passkeys;
  const afterOwner = await debateOwner(debateId);

  assert({
    given:
      'a live session, an enrolled passkey and an owned debate, then a migration re-application and an app restart',
    should:
      'migrate cleanly and serve the same identity, passkey and debate ownership afterwards',
    actual: {
      migrationExit,
      identity: after.state,
      userId: userIdOf(after),
      passkeys: afterPasskeys,
      ownerBefore: beforeOwner,
      ownerAfter: afterOwner,
    },
    expected: {
      migrationExit: 0,
      identity: before.state,
      userId,
      passkeys: beforePasskeys,
      ownerBefore: { userId, phase: 'waiting' },
      ownerAfter: { userId, phase: 'waiting' },
    },
  });
  assert({
    given: 'the passkey enrolled before the restart',
    should: 'still be stored for the account',
    actual: beforePasskeys,
    expected: 1,
  });
});
