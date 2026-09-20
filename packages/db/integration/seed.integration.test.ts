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
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000101',
];

async function runSeed(): Promise<void> {
  const process = Bun.spawn(['bun', 'run', 'db:seed'], {
    cwd: new URL('../..', import.meta.url).pathname,
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
  test('rerunning the seed preserves UUIDs, data, and its durable version marker', async () => {
    const database = new SQL(url, { max: 1 });
    try {
      await runSeed();
      const first = await database`
        select
          (select jsonb_agg(to_jsonb(users) order by id) from users where id in (${seedIds[0]}::uuid, ${seedIds[1]}::uuid)) as users,
          (select jsonb_agg(to_jsonb(debates) order by id) from debates where id = ${seedIds[2]}::uuid) as debates,
          (select jsonb_agg(to_jsonb(seed_versions) order by seed_name) from seed_versions where seed_name = 'agent') as versions
      `;

      await runSeed();
      const second = await database`
        select
          (select jsonb_agg(to_jsonb(users) order by id) from users where id in (${seedIds[0]}::uuid, ${seedIds[1]}::uuid)) as users,
          (select jsonb_agg(to_jsonb(debates) order by id) from debates where id = ${seedIds[2]}::uuid) as debates,
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
        await database`delete from debates where id = ${seedIds[2]}::uuid`;
        await database`delete from users where id in (${seedIds[0]}::uuid, ${seedIds[1]}::uuid)`;
        await database`delete from seed_versions where seed_name = 'agent'`;
      } finally {
        await database.close();
      }
    }
  });
});
