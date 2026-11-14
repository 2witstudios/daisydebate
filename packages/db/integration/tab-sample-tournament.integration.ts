import { assert, test } from 'riteway/bun';
import { integrationSuite } from './suite.test-support';
import {
  asRuntime,
  inRolledBackTransaction,
  loadSampleTournament,
} from './tab.test-support';

const { databaseUrl: url } = integrationSuite();

/**
 * TAB-4.16: half of the schema slice's proof of done. The sample
 * tournament is written by the runtime role under scope, and what the
 * standings and season folds read comes back without touching a Room.
 */
test('the sample tournament loads through the runtime role under scope', async () => {
  await inRolledBackTransaction(url, async (sql) => {
    const ids = await loadSampleTournament(sql);
    const counts = await asRuntime(sql, { lobbyId: ids.lobby }, async () => {
      const count = async (table: string) =>
        (
          (await sql.unsafe(
            `select count(*)::int as rows from ${table} where lobby_id = $1`,
            [ids.lobby],
          )) as Array<{ rows: number }>
        )[0]!.rows;
      return {
        events: await count('events'),
        timeSlots: await count('time_slots'),
        tabRounds: await count('tab_rounds'),
        entries: await count('entries'),
        fixtures: await count('fixtures'),
        results: await count('results'),
        releases: await count('releases'),
      };
    });
    assert({
      given: 'the sample tournament written as daisy_web with scope set',
      should:
        'hold both shapes: three events, shared time slots, a pairing, a bye and a section, and a correction beside the two originals',
      actual: counts,
      expected: {
        events: 3,
        timeSlots: 3,
        tabRounds: 5,
        entries: 6,
        fixtures: 3,
        results: 3,
        releases: 1,
      },
    });
  });
});

test('standings and season folds read their inputs without a Room', async () => {
  await inRolledBackTransaction(url, async (sql) => {
    const ids = await loadSampleTournament(sql);
    const { standings, speakers, season } = await asRuntime(
      sql,
      { lobbyId: ids.lobby, organizationId: ids.league },
      async () => ({
        // An event's standings: what each entry got from the results that
        // no later result supersedes.
        standings: (await sql.unsafe(
          `select e.name, e.division, re.won, re.ballots_won
           from results r
           join result_entries re on re.result_id = r.id
           join entries e on e.id = re.entry_id
           where r.event_id = $1
             and not exists (select 1 from results later where later.supersedes_result_id = r.id)
           order by e.name`,
          [ids.debate],
        )) as unknown[],
        speakers: (
          (await sql.unsafe(
            `select count(*)::int as rows, sum(rs.points)::float as points
             from results r join result_speakers rs on rs.result_id = r.id
             where r.event_id = $1`,
            [ids.debate],
          )) as unknown[]
        )[0],
        // A league's season: its rule, its approved sanctions and exactly
        // the results a certification named.
        season: (await sql.unsafe(
          `select rule.counting, s.status, count(cr.result_id)::int as certified,
             bool_or(cr.result_id = $2) as correction_certified
           from season_standing_rules rule
           join sanctions s on s.season_id = rule.season_id and s.status = 'approved'
           join certifications c on c.event_id = s.event_id
           join certification_results cr on cr.certification_id = c.id
           where rule.season_id = $1
           group by rule.counting, s.status`,
          [ids.season, ids.correction],
        )) as unknown[],
      }),
    );
    assert({
      given: 'the sample tournament, read as daisy_web under its scope',
      should:
        'give every standings input from results, with the correction in force, and the season its rule, sanction and certified results, the correction not among them',
      actual: { standings, speakers, season },
      expected: {
        standings: [
          { name: 'Team 1', division: null, won: false, ballots_won: 0 },
          { name: 'Team 2', division: 'novice', won: true, ballots_won: 1 },
          { name: 'Team 3', division: 'novice', won: true, ballots_won: null },
        ],
        speakers: { rows: 4, points: 116 },
        season: [
          {
            counting: 'sanction',
            status: 'approved',
            certified: 2,
            correction_certified: false,
          },
        ],
      },
    });
  });
});
