import { join } from 'node:path';
import { createId } from '@paralleldrive/cuid2';
import { SQL } from 'bun';
import { requireTestServices } from '@daisy/config';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';

setupRitewayBun();

const { databaseUrl, redisUrl } = requireTestServices(process.env);

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');
const POST_RESTORE_INVALIDATE = join(
  REPO_ROOT,
  'scripts',
  'post-restore-invalidate.ts',
);
const STAGING_RESTORE_SEED = join(
  REPO_ROOT,
  'scripts',
  'staging-restore-seed.ts',
);
const REDIS_NAMESPACE = 'guard-test-namespace';

// The two guards' refusal messages differ only in this context clause
// (restore-guard.ts's `nameRefusal`), so asserting one specifically is what
// proves a given scenario failed through its own guard, not the other one
// or an unrelated crash (NC35: only the URL-string guard's throw removed —
// the actual-name guard downstream still refuses, with different text;
// NC37: an early, unrelated crash — also non-zero, with unrelated text).
const RESTORE_URL_GUARD_MESSAGE =
  'This command is destructive to every session and verification row.';
const STAGING_URL_GUARD_MESSAGE =
  'This script writes synthetic auth and debate rows.';
const ACTUAL_NAME_GUARD_MESSAGE =
  'The database this connection actually landed on does not match what its URL claimed.';

/**
 * The same trick both scripts' `current_database()` guard exists to catch:
 * a `?database=` query parameter overrides which database Bun's `SQL`
 * client actually connects to, regardless of the URL's own path.
 * `pretendPath` satisfies a name-pattern guard's URL-string check while the
 * connection lands on `baseUrl`'s real database.
 */
function withDatabaseOverride(baseUrl: string, pretendPath: string): string {
  const url = new URL(baseUrl);
  const realDatabase = url.pathname.replace(/^\//, '');
  url.pathname = `/${pretendPath}`;
  url.searchParams.set('database', realDatabase);
  return url.toString();
}

/**
 * Spawns the real script and asserts it refuses through the specific guard
 * `expectedStderr` names — exit code exactly 1 (Bun's uncaught-throw code,
 * never merely "non-zero") and that message on stderr — without mutating
 * anything. A generic "non-zero exit" check passes for the wrong reason
 * under NC35 (only the URL-string guard's throw removed; the downstream
 * actual-name guard still refuses, with different text) and NC37 (an early,
 * unrelated crash); requiring this scenario's own message rules both out.
 */
async function assertRefusesWithoutMutating(
  given: string,
  scriptPath: string,
  args: readonly string[],
  env: Readonly<Record<string, string>>,
  expectedStderr: string,
  checkUnaffected: () => Promise<boolean>,
): Promise<void> {
  const result = Bun.spawnSync(['bun', scriptPath, ...args], {
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const unaffected = await checkUnaffected();
  assert({
    given,
    should:
      'exit exactly 1 with this guard’s own refusal message on stderr, and leave the database unaffected',
    actual: {
      exitCode: result.exitCode,
      refusedByThisGuard: result.stderr.toString().includes(expectedStderr),
      unaffected,
    },
    expected: { exitCode: 1, refusedByThisGuard: true, unaffected: true },
  });
}

// staging-restore-seed.ts's own fixed ids — deleted before and after each
// test, in FK order, so a guard regression that lets the seed through
// (exactly the failure mode these tests exist to catch) never leaves rows
// behind for the next run to trip over.
async function cleanupStagingSeedRows(db: SQL): Promise<void> {
  await db`delete from debate_participants where debate_id = 'n9o0p1q2r3s4t5u6v7w8x9y0'`;
  await db`delete from debates where id = 'n9o0p1q2r3s4t5u6v7w8x9y0'`;
  await db`delete from session where id in ('restore-seed-session-0', 'restore-seed-session-1')`;
  await db`delete from passkey where id in ('restore-seed-passkey-0', 'restore-seed-passkey-1')`;
  await db`delete from verification where id = 'restore-seed-verification-0'`;
  await db`delete from actors where id in ('d3e4f5g6h7i8j9k0l1m2n3o4', 'b7c8d9e0f1g2h3i4j5k6l7m8')`;
  await db`delete from users where id in ('r1s2t3u4v5w6x7y8z9a0b1c2', 'p5q6r7s8t9u0v1w2x3y4z5a6')`;
}

describe('post-restore-invalidate.ts (AUTH-7.16/7.17, NC33/NC35/NC37 regression guard)', () => {
  const scenarios = [
    {
      title:
        "a DATABASE_URL whose own database name isn't a restore copy, deleting nothing",
      databaseUrl: () => databaseUrl,
      expectedStderr: RESTORE_URL_GUARD_MESSAGE,
    },
    {
      title:
        'a DATABASE_URL path naming a restore copy but a ?database= override landing elsewhere, deleting nothing',
      databaseUrl: () =>
        withDatabaseOverride(databaseUrl, 'pretend_restore_copy'),
      expectedStderr: ACTUAL_NAME_GUARD_MESSAGE,
    },
  ];

  for (const scenario of scenarios) {
    test(`refuses ${scenario.title}`, async () => {
      const db = new SQL(databaseUrl, { max: 1 });
      const markerId = `guard-test-${createId()}`;
      try {
        await db`insert into verification (id, identifier, value, expires_at)
          values (${markerId}, 'guard-test', 'guard-test', now() + interval '1 hour')`;
        // The Redis confirmation flags match exactly, so only the
        // database-name guard each scenario targets can still refuse — a
        // regression there, not an unrelated Redis refusal, is what should
        // make this test fail.
        await assertRefusesWithoutMutating(
          scenario.title,
          POST_RESTORE_INVALIDATE,
          [
            '--confirm-redis-namespace',
            REDIS_NAMESPACE,
            '--confirm-redis-host',
            new URL(redisUrl).host,
          ],
          {
            PATH: process.env.PATH ?? '',
            DATABASE_URL: scenario.databaseUrl(),
            REDIS_URL: redisUrl,
            REDIS_NAMESPACE,
          },
          scenario.expectedStderr,
          async () =>
            (await db`select id from verification where id = ${markerId}`)
              .length === 1,
        );
      } finally {
        await db`delete from verification where id = ${markerId}`;
        await db.close();
      }
    });
  }
});

describe('staging-restore-seed.ts (AUTH-7.16/7.17, NC33/NC35/NC37 regression guard)', () => {
  const scenarios = [
    {
      title:
        "a DATABASE_URL whose own database name isn't a staging copy, inserting nothing",
      databaseUrl: () => databaseUrl,
      expectedStderr: STAGING_URL_GUARD_MESSAGE,
    },
    {
      title:
        'a DATABASE_URL path naming a staging copy but a ?database= override landing elsewhere, inserting nothing',
      databaseUrl: () =>
        withDatabaseOverride(databaseUrl, 'pretend_staging_copy'),
      expectedStderr: ACTUAL_NAME_GUARD_MESSAGE,
    },
  ];

  for (const scenario of scenarios) {
    test(`refuses ${scenario.title}`, async () => {
      const db = new SQL(databaseUrl, { max: 1 });
      try {
        await cleanupStagingSeedRows(db);
        await assertRefusesWithoutMutating(
          scenario.title,
          STAGING_RESTORE_SEED,
          [],
          {
            PATH: process.env.PATH ?? '',
            DATABASE_URL: scenario.databaseUrl(),
          },
          scenario.expectedStderr,
          async () =>
            (
              await db`select id from users where username = 'restore-rehearsal-a'`
            ).length === 0,
        );
      } finally {
        await cleanupStagingSeedRows(db);
        await db.close();
      }
    });
  }
});
