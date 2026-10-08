import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { SQL } from 'bun';
import { resolve } from 'node:path';
import { requireTestServices } from '@daisy/config';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);

const seedIds = [
  'k2v9x0f4m8q3w1z7c5n6b4d2',
  'a7b3c9d1e5f2k4m6n8p1r3t5',
  'c8d4e2f6a1b3k5m7n9p2r4t6',
];
const seedActorIds = ['h3j7m1p5r9t2v6x0z4b8d2f6', 'q5s9u3w7y1a4c8e2g6j0l4n8'];

/** Removes the rows the seeds insert, children first. */
const removeSeedRows = async (database: SQL) => {
  // Clear execution first: utterances restrict participant deletion.
  await database`delete from round_segments where round_id = ${seedIds[2]}`;
  // The seeded round's participants cascade from it.
  await database`delete from rounds where id = ${seedIds[2]}`;
  await database`delete from actors where id in (${seedActorIds[0]}, ${seedActorIds[1]})`;
  await database`delete from users where id in (${seedIds[0]}, ${seedIds[1]})`;
  await database`delete from seed_versions where seed_name in ('agent', 'formats')`;
};

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

describe('reference data', () => {
  test('db:seed never writes reference data: the baseline owns it', async () => {
    const database = new SQL(url, { max: 1 });
    const [original] =
      await database`select name from formats where id = 'foundation'`;
    try {
      // A marker only a second writer would overwrite.
      await database`update formats set name = 'marker-not-a-seed-value' where id = 'foundation'`;
      await runSeed();
      const [after] = await database`
        select
          (select name from formats where id = 'foundation') as name,
          (select count(*)::int from seed_versions where seed_name = 'formats') as format_markers
      `;
      assert({
        given: 'the foundation format changed after migration, then db:seed',
        should: 'leave the formats row alone and record no formats seed marker',
        actual: after,
        expected: { name: 'marker-not-a-seed-value', format_markers: 0 },
      });
    } finally {
      try {
        await database`update formats set name = ${original?.name} where id = 'foundation'`;
        await removeSeedRows(database);
      } finally {
        await database.close();
      }
    }
  });
});

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
          (select jsonb_agg(to_jsonb(rounds) order by id) from rounds where id = ${seedIds[2]}) as debates,
          (select jsonb_agg(to_jsonb(seed_versions) order by seed_name) from seed_versions where seed_name in ('agent', 'formats')) as versions
      `;

      await runSeed();
      const second = await database`
        select
          (select jsonb_agg(to_jsonb(users) order by id) from users where id in (${seedIds[0]}, ${seedIds[1]})) as users,
          (select jsonb_agg(to_jsonb(actors) order by id) from actors where id in (${seedActorIds[0]}, ${seedActorIds[1]})) as actors,
          (select jsonb_agg(to_jsonb(formats) order by id) from formats where id = 'foundation') as formats,
          (select jsonb_agg(to_jsonb(rounds) order by id) from rounds where id = ${seedIds[2]}) as debates,
          (select jsonb_agg(to_jsonb(seed_versions) order by seed_name) from seed_versions where seed_name in ('agent', 'formats')) as versions
      `;

      assert({
        given: 'an already-seeded isolated test database',
        should:
          'preserve the complete seeded records and version marker on rerun',
        actual: second,
        expected: first,
      });

      // A developer advanced the seed round: reseeding must return every
      // lifecycle projection to scheduled, or the CHECK rolls the seed back.
      await database`
        update rounds
        set status = 'active', current_stage = 'countdown', started_at = now(),
            runtime_state = runtime_state || '{"active_prep":{"side":"affirmative","started_at":"2026-01-01T00:00:00.000Z"}}'::jsonb
        where id = ${seedIds[2]}
      `;
      await database`
        insert into round_segments
          (id, round_id, sequence, type, rules_segment_key, started_at, ended_at, duration_ms)
        select 'seed-segment-' || sequence, id, sequence, segment->>'type',
               segment->>'key', '2026-01-01T00:00:00Z'::timestamptz,
               case when sequence = 0 then '2026-01-01T00:01:00Z'::timestamptz end,
               (segment->>'durationMs')::int
        from rounds,
             lateral jsonb_array_elements(rules_snapshot->'segments') with ordinality as item(segment, ordinal),
             lateral (select (ordinal - 1)::int as sequence) as position
        where id = ${seedIds[2]} and sequence < 2
      `;
      await database`
        insert into utterances (id, round_id, segment_id, round_participant_id, sequence, text)
        select 'seed-spoken-line', round_id, 'seed-segment-0', id, 0, 'Previous speech'
        from round_participants where round_id = ${seedIds[2]} and role = 'affirmative'
      `;
      await runSeed();
      const [reset] = await database`
        select status, current_stage, started_at, completed_at, outcome,
               runtime_state->'active_prep' as active_prep,
               jsonb_typeof(rules_snapshot) as rules_type,
               jsonb_typeof(runtime_state) as runtime_type,
               (select count(*)::int from round_segments where round_id = ${seedIds[2]}) as segments,
               (select count(*)::int from utterances where round_id = ${seedIds[2]}) as utterances
        from rounds where id = ${seedIds[2]}
      `;
      assert({
        given: 'a seed round that progressed to active before a reseed',
        should:
          'reset lifecycle, checkpoint, open and closed segments and their utterances',
        actual: reset,
        expected: {
          status: 'scheduled',
          current_stage: null,
          started_at: null,
          completed_at: null,
          outcome: null,
          active_prep: null,
          // Not a double-encoded JSON string: the runtime must read it back.
          rules_type: 'object',
          runtime_type: 'object',
          segments: 0,
          utterances: 0,
        },
      });
    } finally {
      try {
        await removeSeedRows(database);
      } finally {
        await database.close();
      }
    }
  });
});
