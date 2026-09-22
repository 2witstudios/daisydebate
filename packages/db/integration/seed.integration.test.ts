import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { SQL } from 'bun';
import { resolve } from 'node:path';

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
const seedActorIds = ['h3j7m1p5r9t2v6x0z4b8d2f6', 'q5s9u3w7y1a4c8e2g6j0l4n8'];

// A filesystem path, not URL.pathname: that stays percent-encoded, so a
// checkout path containing a space would not exist as a spawn cwd.
const repositoryRoot = resolve(import.meta.dir, '../../..');

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
          (select jsonb_agg(to_jsonb(actors) order by id) from actors where id in (${seedActorIds[0]}, ${seedActorIds[1]})) as actors,
          (select jsonb_agg(to_jsonb(formats) order by id) from formats where id = 'foundation') as formats,
          (select jsonb_agg(to_jsonb(debates) order by id) from debates where id = ${seedIds[2]}) as debates,
          (select jsonb_agg(to_jsonb(seed_versions) order by seed_name) from seed_versions where seed_name in ('agent', 'formats')) as versions
      `;

      await runSeed();
      const second = await database`
        select
          (select jsonb_agg(to_jsonb(users) order by id) from users where id in (${seedIds[0]}, ${seedIds[1]})) as users,
          (select jsonb_agg(to_jsonb(actors) order by id) from actors where id in (${seedActorIds[0]}, ${seedActorIds[1]})) as actors,
          (select jsonb_agg(to_jsonb(formats) order by id) from formats where id = 'foundation') as formats,
          (select jsonb_agg(to_jsonb(debates) order by id) from debates where id = ${seedIds[2]}) as debates,
          (select jsonb_agg(to_jsonb(seed_versions) order by seed_name) from seed_versions where seed_name in ('agent', 'formats')) as versions
      `;

      assert({
        given: 'an already-seeded isolated test database',
        should:
          'preserve the complete seeded records and version marker on rerun',
        actual: second,
        expected: first,
      });

      // A developer advanced the seed debate: reseeding must return every
      // lifecycle projection to waiting, or the CHECK rolls the seed back.
      await database`
        update debates
        set phase = 'active', started_at = now(), snapshot = snapshot || '{"phase":"active"}'::jsonb
        where id = ${seedIds[2]}
      `;
      await runSeed();
      const [reset] = await database`
        select phase, started_at, completed_at, outcome, snapshot->>'phase' as snapshot_phase, jsonb_typeof(snapshot) as snapshot_type
        from debates where id = ${seedIds[2]}
      `;
      assert({
        given: 'a seed debate that progressed to active before a reseed',
        should:
          'reset phase, snapshot and every lifecycle projection to waiting',
        actual: reset,
        expected: {
          phase: 'waiting',
          started_at: null,
          completed_at: null,
          outcome: null,
          snapshot_phase: 'waiting',
          // Not a double-encoded JSON string: the engine must restore it.
          snapshot_type: 'object',
        },
      });
    } finally {
      try {
        await database`delete from debates where id = ${seedIds[2]}`;
        await database`delete from actors where id in (${seedActorIds[0]}, ${seedActorIds[1]})`;
        await database`delete from users where id in (${seedIds[0]}, ${seedIds[1]})`;
        await database`delete from seed_versions where seed_name in ('agent', 'formats')`;
      } finally {
        await database.close();
      }
    }
  });
});
