import {
  leagueRoomRating,
  openLeagueRatingSeason,
} from './league-room-rating.test-support';
import { requireTestServices } from '@daisy/config';
import {
  scratchDatabase,
  committingRuntimeTestDatabase,
} from '@daisy/db/testing';
import { createTabStore } from '@daisy/db/tab';
import { authorize } from '@daisy/auth/authorization';
import { SQL } from 'bun';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  createBots,
  scriptClock,
  type World,
} from './tab-tournament.test-support';
import { organizationStage } from './tab-tournament-organization.test-support';
import { leagueAdministrationStage } from './tab-tournament-league-administration.test-support';
import { leagueConfigurationStage } from './tab-tournament-league-configuration.test-support';
import { as } from './tab-tournament-organization-wiring.test-support';
import { readLeagueLadder } from '../src/features/ratings/read-league-ladder';
import { leagueStandings } from '../src/features/ratings/league-input';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

const games = 5_000;
const pool = 200;
const runs = 7;

/** Every insertable column of a table, in order (generated columns excluded). */
type Column = { readonly name: string; readonly timestamp: boolean };

const columnsOf = async (sql: SQL, table: string): Promise<Column[]> =>
  (
    (await sql`select column_name, data_type from information_schema.columns where table_schema='public' and table_name=${table} and is_generated='NEVER' order by ordinal_position`) as {
      column_name: string;
      data_type: string;
    }[]
  ).map((row) => ({
    name: row.column_name,
    timestamp: row.data_type.startsWith('timestamp'),
  }));

/**
 * Copy one finished row set `copies` times in a single statement: every
 * column is the template's own value unless an override names it, so the
 * clones satisfy exactly the CHECKs and foreign keys the real Round did.
 */
const clone = async (
  sql: SQL,
  input: {
    readonly table: string;
    readonly where: string;
    readonly overrides: (column: {
      readonly name: string;
      readonly timestamp: boolean;
    }) => string | null;
  },
) => {
  const columns = await columnsOf(sql, input.table);
  const values = columns.map(
    (column) => input.overrides(column) ?? `t.${column.name}`,
  );
  await sql.unsafe(
    `insert into ${input.table} (${columns.map((c) => c.name).join(',')}) select ${values.join(',')} from ${input.table} t cross join generate_series(1, ${games - 1}) g where ${input.where}`,
  );
};

const id = (kind: string) => `'z' || substr(md5('${kind}:' || g), 1, 23)`;
const percentile = (sorted: readonly number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!;

test('a league ladder of 5,000 posted games reads well under a second', async () => {
  const scratch = scratchDatabase(databaseUrl, 'leaguescale');
  await scratch.create();
  const owner = new SQL(scratch.url, { max: 4 });
  try {
    await scratch.migrate(() => true);
    const bots = await createBots(owner, [
      'Director',
      'Staff',
      'Coach',
      'Judge A',
      'Judge B',
      'Judge C',
      'Debater 1',
      'Debater 2',
      'Debater 3',
      'Debater 4',
    ]);
    const world: World = {
      database: committingRuntimeTestDatabase(owner),
      sql: owner,
      runtimeDatabaseUrl: scratch.url,
      clock: scriptClock(Date.now() - 60 * 60_000),
      bots: Object.fromEntries(bots.map((bot) => [bot.name, bot])),
      made: new Map(),
    };
    for (const run of [
      organizationStage,
      leagueAdministrationStage,
      leagueConfigurationStage,
    ])
      await run(world);
    // One league-rated Round made by the real Room Ready, Start and forfeit
    // operations is the template every seeded game copies.
    await openLeagueRatingSeason(world);
    await leagueRoomRating(world);
    const lobbyId = world.made.get('standing-lobby')!;
    const [ladder] =
      await owner`select id from ladders where lobby_id=${lobbyId}`;
    const [template] =
      await owner`select r.id, r.room_id, f.command_id, f.freeze_revision from rounds r join round_finalizations f on f.round_id=r.id where r.ladder_id=${ladder!.id}`;
    if (!template || template.freeze_revision !== null)
      throw new Error(`Unexpected template Round: ${JSON.stringify(template)}`);
    // Every per-Round row the template holds must be copied, or a clone's
    // ending facts differ from the template's (and it may silently not rate).
    const perRound =
      await owner`select table_name from information_schema.columns where table_schema='public' and column_name='round_id' order by table_name`;
    const held: Record<string, number> = {};
    for (const { table_name } of perRound as { table_name: string }[]) {
      const [row] = await owner.unsafe(
        `select count(*)::int as n from ${table_name} where round_id=$1`,
        [template.id],
      );
      if (row.n > 0) held[table_name] = row.n;
    }
    const copied = new Set([
      'round_participants',
      'round_commands',
      'round_finalizations',
      'round_check_in_attempts',
      // Written for each new Round by its own trigger, not by the seed.
      'spectator_fact_log_open_rounds',
    ]);
    // Rows a Round holds that no ending fact reads, so a clone needs none:
    // the draw seed every Start round mints (ADR 0145), read only by Start's
    // seat and resolution draws; and the notifications its start and decision
    // owe its members (ADR 0144), which tell people and rate nothing.
    const notEnding = new Set([
      'round_draw_seeds',
      'notifications',
      'rating_changes',
    ]);
    const uncopied = Object.keys(held).filter(
      (table) => !copied.has(table) && !notEnding.has(table),
    );
    if (uncopied.length)
      throw new Error(`Template rows the seed does not copy: ${uncopied}`);
    const debaters = await createBots(
      owner,
      Array.from({ length: pool }, (_, index) => `Pool ${index + 1}`),
    );
    const actors = `array[${debaters.map((bot) => `'${bot.actorId}'`).join(',')}]`;
    const room = id('room');
    const round = id('round');
    const command = id('command');
    const seededAt = performance.now();
    await owner.begin(async (tx) => {
      await clone(tx, {
        table: 'rooms',
        where: `t.id='${template.room_id}'`,
        overrides: (c) => (c.name === 'id' ? room : null),
      });
      // A Round's cast freezes while it is constructed (active, version 1, in
      // this transaction); the terminal transition then copies the template's.
      const shifted = (c: { readonly name: string }) =>
        `t.${c.name} - (${games} - g) * interval '1 minute'`;
      await clone(tx, {
        table: 'rounds',
        where: `t.id='${template.id}'`,
        overrides: (c) =>
          ({
            id: round,
            room_id: room,
            status: `'active'`,
            current_stage: `'live'`,
            resolution: `coalesce(t.resolution, 'Seeded resolution')`,
            winning_side: 'null',
            ranking: 'null',
            completed_at: 'null',
            version: '1',
          })[c.name] ?? (c.timestamp ? shifted(c) : null),
      });
      // Two distinct pool members per game: offsets 1..199 never collide.
      await clone(tx, {
        table: 'round_participants',
        where: `t.round_id='${template.id}' and t.seat_kind='side'`,
        overrides: (c) =>
          c.name === 'id'
            ? `'z' || substr(md5('seat:' || g || t.id), 1, 23)`
            : c.name === 'round_id'
              ? round
              : c.name === 'actor_id'
                ? `case when t.side='affirmative' then (${actors})[1 + (g * 7) % ${pool}] else (${actors})[1 + (g * 7 + 1 + g % ${pool - 1}) % ${pool}] end`
                : null,
      });
      await tx.unsafe(
        `update rounds r set status='completed', current_stage=null, completed_at=r.started_at + (t.completed_at - t.started_at), winning_side=case when md5('winner:' || r.id) < '8' then 'affirmative' else 'negative' end, ranking=t.ranking, resolution=t.resolution, version=t.version from rounds t where t.id='${template.id}' and r.id<>t.id and r.status='active' and r.ladder_id=t.ladder_id`,
      );
      await clone(tx, {
        table: 'round_commands',
        where: `t.command_id='${template.command_id}'`,
        overrides: (c) =>
          c.name === 'command_id'
            ? command
            : c.name === 'round_id'
              ? round
              : c.timestamp
                ? shifted(c)
                : null,
      });
      await clone(tx, {
        table: 'round_finalizations',
        where: `t.round_id='${template.id}'`,
        overrides: (c) =>
          c.name === 'round_id'
            ? round
            : c.name === 'command_id'
              ? command
              : null,
      });
      // The template's settled (aborted) check-in writer: the attendance fact
      // `pendingWriter` reads, so each clone ends exactly as the template did.
      await clone(tx, {
        table: 'round_check_in_attempts',
        where: `t.round_id='${template.id}'`,
        overrides: (c) =>
          c.name === 'attempt_id'
            ? `'z' || substr(md5('attempt:' || g || t.attempt_id), 1, 23)`
            : c.name === 'command_id'
              ? `'z' || substr(md5('attempt-command:' || g || t.command_id), 1, 23)`
              : c.name === 'round_id'
                ? round
                : null,
      });
    });
    // The real Room above proved transactional posting. Seed the remaining
    // ledger and projection rows here so this proof measures only the read.
    await owner.begin(async (tx) => {
      await tx`insert into rating_changes
        (id,round_id,actor_id,season_id,ladder,lobby_id,format_id,
         rating_before,rating_after,deviation_before,deviation_after,
         volatility_before,volatility_after,calculation_version,occurred_at)
        select 'z'||substr(md5(p.id),1,23),r.id,p.actor_id,r.season_id,r.ladder_id,r.rating_lobby_id,r.format_id,
               1500,1500,300,300,0.06,0.06,'glicko2-v1',r.completed_at
        from rounds r join round_participants p on p.round_id=r.id and p.seat_kind='side'
        where r.ladder_id=${ladder!.id} and r.id<>${template.id}`;
      await tx`insert into ratings
        (actor_id,season_id,ladder,lobby_id,rating,deviation,volatility)
        select distinct actor_id,season_id,ladder,lobby_id,1500,300,0.06
        from rating_changes where ladder=${ladder!.id} and round_id<>${template.id}
        on conflict do nothing`;
    });
    const seedMs = performance.now() - seededAt;
    await owner`analyze`;
    const [count] =
      await owner`select count(*)::int as rounds, (select count(*)::int from round_participants p join rounds r on r.id=p.round_id where r.ladder_id=${ladder!.id} and p.seat_kind='side') as seats from rounds r join round_finalizations f on f.round_id=r.id where r.ladder_id=${ladder!.id} and r.status='completed'`;
    assert({
      given: 'the seeded league',
      should: 'hold 5,000 finalized league-rated Rounds with two seats each',
      actual: [count!.rounds, count!.seats],
      expected: [games, games * 2],
    });

    const store = createTabStore(world.database);
    const read = readLeagueLadder({ store, authorize });
    const principal = as(world.bots.Director!);
    const first = await read(principal, { lobbyId });
    const timings: number[] = [];
    for (let run = 0; run < runs; run++) {
      const started = performance.now();
      await read(principal, { lobbyId });
      timings.push(performance.now() - started);
    }
    // Split the same read into its database load and its in-memory fold.
    const loads: number[] = [];
    const folds: number[] = [];
    for (let run = 0; run < runs; run++) {
      const started = performance.now();
      await store.leagueRatings(
        { viewerUserId: principal.userId, lobbyId },
        async (facts) => {
          loads.push(performance.now() - started);
          const folding = performance.now();
          leagueStandings(facts!.input);
          folds.push(performance.now() - folding);
        },
      );
    }
    const pages = await Promise.all(
      Array.from({ length: first?.pages ?? 0 }, (_, index) =>
        read(principal, { lobbyId, page: index + 1 }),
      ),
    );
    const played = pages
      .flatMap((page) => page?.lines ?? [])
      .reduce((sum, line) => sum + line.wins + line.losses, 0);
    const sorted = [...timings].sort((a, b) => a - b);
    const median = percentile(sorted, 0.5);
    const p95 = percentile(sorted, 0.95);
    const middle = (values: readonly number[]) =>
      percentile(
        [...values].sort((a, b) => a - b),
        0.5,
      ).toFixed(1);
    process.stdout.write(
      `league ladder scale: ${games} games, ${first?.entrants} entrants, seed ${seedMs.toFixed(0)} ms; read median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms over ${runs} warm runs (${sorted.map((ms) => ms.toFixed(0)).join(', ')}); load median ${middle(loads)} ms, fold median ${middle(folds)} ms\n`,
    );
    assert({
      given:
        '5,000 league games among a 200-debater pool and the template pair',
      should: 'rate every entrant and count each side seat as one game',
      actual: [first?.entrants, played],
      expected: [pool + 2, games * 2],
    });
    assert({
      given: 'the shared ledger read at 5,000 games',
      should: 'answer in under one second at the median',
      actual: median < 1_000,
      expected: true,
    });
  } finally {
    await owner.close();
    await scratch.drop();
  }
}, 600_000);
