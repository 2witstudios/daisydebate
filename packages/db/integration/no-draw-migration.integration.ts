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
const noDraw = '20261103051134_no_draw_no_ballot_status';
const scratch = scratchDatabase(databaseUrl, 'nodraw');
afterAll(() => scratch.drop());

test(
  'a stored draw becomes no result, and neither it nor a ballot can refuse the deploy (ISSUE-1027, ISSUE-1080)',
  async () => {
    await scratch.create();
    await scratch.migrate((folder) => folder < noDraw);
    const client = new SQL(scratch.url);
    const f = new Fixture(client);
    try {
      const at = new Date('2026-10-31T16:00:00.000Z');
      const actor = await f.actor();
      const roundId = await f.round({
        status: 'completed',
        outcome: 'draw',
        started_at: at,
        completed_at: at,
        competition_type: 'ranked',
        ladder_id: 'freestyle',
        preset_version: 1,
        format_id: 'freestyle',
        format_version: 1,
      });
      await f.participant(roundId, 'affirmative', 0, actor);
      // A human judge with no ballot: the completion guard would refuse this row.
      await f.participant(roundId, 'judge', 0, await f.actor());
      const seasonId = createId();
      await f.insert('seasons', {
        id: seasonId,
        name: 'Retained',
        starts_at: at,
        status: 'active',
      });
      await f.insert('rating_changes', {
        id: createId(),
        round_id: roundId,
        actor_id: actor,
        format_id: 'freestyle',
        ladder: 'freestyle',
        season_id: seasonId,
        rating_before: 1500,
        rating_after: 1500,
        deviation_before: 350,
        deviation_after: 300,
        volatility_before: 0.06,
        volatility_after: 0.06,
        calculation_version: 'glicko2-v1',
        occurred_at: at,
      });
      const commandId = createId();
      await f.insert(
        'round_commands',
        {
          command_id: commandId,
          round_id: roundId,
          actor_id: actor,
          type: 'submit_ballot',
          payload_digest: 'a'.repeat(64),
          result: { outcome: 'draw', ballotId: 'b'.repeat(24) },
          resulting_version: 2,
          applied_at: at,
        },
        'command_id',
      );
      await scratch.migrate((folder) => folder <= noDraw);
      const [row] = await client`select
        (select outcome from rounds where id=${roundId}) as outcome,
        (select result from round_commands where command_id=${commandId}) as result,
        (select count(*)::int from rating_changes where round_id=${roundId}) as postings,
        (select count(*)::int from information_schema.columns
          where table_name='ballots' and column_name='status') as "statusColumn",
        (select tgenabled from pg_trigger
          where tgname='rounds_winnerless_completion_check') as guard`;
      assert({
        given: 'a rated draw and its ballot receipt',
        should:
          'hold no outcome and no posting, its receipt still parsing, the guard enabled again',
        actual: row,
        expected: {
          outcome: null,
          result: { outcome: null, ballotId: 'b'.repeat(24) },
          postings: 0,
          statusColumn: 0,
          guard: 'O',
        },
      });
      const refused =
        await client`update rounds set outcome='draw' where id=${roundId}`.then(
          () => 'accepted',
          (error: { constraint?: string }) => error.constraint,
        );
      assert({
        given: 'a draw written after the migration',
        should: 'refuse it',
        actual: refused,
        expected: 'rounds_outcome_check',
      });
    } finally {
      await client.close();
    }
  },
  ddlTimeoutMs,
);
