import { afterAll } from 'bun:test';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { SQL } from 'bun';
import { Fixture } from './constraint-helpers';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const migration = '20261028224402_three_rating_ladders';
const scratch = scratchDatabase(databaseUrl, 'ratedpreflight');
afterAll(() => scratch.drop());

test(
  'the complete migration refuses populated predecessor schema without changing data, FK dependents or journal',
  async () => {
    await scratch.create();
    await scratch.migrate((folder) => folder < migration);
    const client = new SQL(scratch.url);
    const f = new Fixture(client);
    try {
      const actor = await f.actor();
      const roundId = await f.round({
        competition_type: 'ranked',
        ladder_id: 'ranked',
        preset_version: 1,
        format_id: 'freestyle',
        format_version: 1,
      });
      await f.participant(roundId, 'affirmative', 0, actor);
      const seasonId = createId();
      await f.insert('seasons', {
        id: seasonId,
        name: 'Retained',
        starts_at: new Date('2026-10-01'),
        status: 'active',
      });
      await f.insert(
        'ratings',
        {
          actor_id: actor,
          format_id: 'freestyle',
          ladder: 'ranked',
          season_id: seasonId,
          rating: 1500,
          deviation: 350,
          volatility: 0.06,
        },
        'actor_id',
      );
      await f.insert('rating_changes', {
        id: createId(),
        round_id: roundId,
        actor_id: actor,
        format_id: 'freestyle',
        ladder: 'ranked',
        season_id: seasonId,
        rating_before: 1500,
        rating_after: 1500,
        deviation_before: 350,
        deviation_after: 300,
        volatility_before: 0.06,
        volatility_after: 0.06,
        calculation_version: 'glicko2-v1',
        occurred_at: new Date('2026-10-02'),
      });
      const snapshot = async () => ({
        data: await f.sql`select (select jsonb_agg(to_jsonb(x)) from ratings x) ratings, (select jsonb_agg(to_jsonb(x)) from rating_changes x) ledger, (select jsonb_agg(to_jsonb(x)) from rounds x) rounds, (select jsonb_agg(to_jsonb(x)) from seasons x) seasons`,
        constraints:
          await f.sql`select conrelid::regclass::text as relation, conname, pg_get_constraintdef(oid) as definition from pg_constraint where connamespace='public'::regnamespace order by conrelid::regclass::text,conname`,
        columns:
          await f.sql`select table_name,column_name,data_type from information_schema.columns where table_schema='public' order by table_name,ordinal_position`,
        journal:
          await f.sql`select * from drizzle.__drizzle_migrations order by id`,
      });
      const before = await snapshot();
      const preflight = Bun.spawn(
        [
          process.execPath,
          new URL('../scripts/rating-preflight.ts', import.meta.url).pathname,
        ],
        { env: { DATABASE_URL: scratch.url }, stdout: 'pipe', stderr: 'pipe' },
      );
      const [exitCode, output] = await Promise.all([
        preflight.exited,
        new Response(preflight.stdout).json(),
      ]);
      assert({
        given:
          'the exact operator preflight command against the populated predecessor database',
        should:
          'refuse with only counts/catalog metadata and preserve the complete database state',
        actual: {
          exitCode,
          counts: output.counts,
          refusal: output.disposition.startsWith('REFUSE:'),
          includesMembership: output.dependents.some(
            (d: { constraint: string }) =>
              d.constraint === 'rating_changes_participant_fk',
          ),
          state: await snapshot(),
        },
        expected: {
          exitCode: 1,
          counts: {
            standings: 1,
            postings: 1,
            rated_rounds: 1,
            rated_rooms: 0,
            seasons: 1,
          },
          refusal: true,
          includesMembership: true,
          state: before,
        },
      });

      let refused = false;
      try {
        await scratch.migrate((folder) => folder <= migration);
      } catch (error) {
        refused = String(error).includes(
          'Three ladders requires explicit disposition',
        );
      }
      assert({
        given:
          'a real migrated predecessor database with retained generic standings, ledger and Round references',
        should:
          'refuse the complete migration and preserve every row, schema column, constraint/FK and journal entry',
        actual: { refused, state: await snapshot() },
        expected: { refused: true, state: before },
      });
    } finally {
      await client.close();
    }
  },
  ddlTimeoutMs,
);
