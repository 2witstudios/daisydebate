import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { SQL } from 'bun';

setupRitewayBun();

const url = process.env.TEST_DATABASE_URL;
if (!url)
  throw new Error(
    'TEST_DATABASE_URL required; never use application database for tests',
  );
if (!new URL(url).pathname.endsWith('_test'))
  throw new Error('Test database name must end in _test');

const seedIds = [
  'k2v9x0f4m8q3w1z7c5n6b4d2',
  'a7b3c9d1e5f2k4m6n8p1r3t5',
  'c8d4e2f6a1b3k5m7n9p2r4t6',
];

const repositoryRoot = new URL('../../..', import.meta.url).pathname;

/**
 * Runs the seed entry point directly instead of `bun run db:seed`, whose
 * `--env-file=.env` exists to supply the development DATABASE_URL. The only
 * database URL the child can see is the `_test` URL validated above.
 */
async function runSeed(): Promise<void> {
  const process = Bun.spawn(['bun', 'scripts/seed.ts'], {
    cwd: repositoryRoot,
    env: { ...Bun.env, DATABASE_URL: url },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if (exitCode !== 0)
    throw new Error(`seed failed (${exitCode}): ${stderr || stdout}`);
}

describe('agent seed', () => {
  test('rerunning the seed preserves identifiers, data, and its durable version marker', async () => {
    const database = new SQL(url, { max: 1 });
    try {
      await runSeed();
      const first = await database`
        select
          (select jsonb_agg(to_jsonb(users) order by id) from users where id in (${seedIds[0]}, ${seedIds[1]})) as users,
          (select jsonb_agg(to_jsonb(debates) order by id) from debates where id = ${seedIds[2]}) as debates,
          (select jsonb_agg(to_jsonb(seed_versions) order by seed_name) from seed_versions where seed_name = 'agent') as versions
      `;

      await runSeed();
      const second = await database`
        select
          (select jsonb_agg(to_jsonb(users) order by id) from users where id in (${seedIds[0]}, ${seedIds[1]})) as users,
          (select jsonb_agg(to_jsonb(debates) order by id) from debates where id = ${seedIds[2]}) as debates,
          (select jsonb_agg(to_jsonb(seed_versions) order by seed_name) from seed_versions where seed_name = 'agent') as versions
      `;

      assert({
        given: 'an already-seeded isolated test database',
        should:
          'preserve the complete seeded records and version marker on rerun',
        actual: second,
        expected: first,
      });
    } finally {
      try {
        await database`delete from debates where id = ${seedIds[2]}`;
        await database`delete from users where id in (${seedIds[0]}, ${seedIds[1]})`;
        await database`delete from seed_versions where seed_name = 'agent'`;
      } finally {
        await database.close();
      }
    }
  });
});
