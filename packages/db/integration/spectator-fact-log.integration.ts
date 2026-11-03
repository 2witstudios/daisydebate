import { requireTestServices } from '@daisy/config';
import { SPECTATOR_MARGIN_MS } from '@daisy/protocol';
import { SQL } from 'bun';
import type { SQL as SQLType } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import { PgDialect } from 'drizzle-orm/pg-core';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  closeSettledFactLogRounds,
  readRoundsAwaitingFactLog,
  recordFactReleases,
  spectatorFactLogOperations,
} from '../src/spectator-fact-log';
import { withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const started = new Date('2026-11-02T00:00:00.000Z');
const ended = new Date('2026-11-02T00:10:00.000Z');
const delay = 90;
const clockAt = (at: Date) => ({
  now: at.toISOString(),
  rankedDelaySeconds: delay,
});
const after = (at: Date, ms: number) => new Date(at.getTime() + ms);

const withEndedRound = async (
  run: (world: {
    readonly db: ReturnType<typeof drizzle>;
    readonly sql: SQL;
    readonly roundId: string;
    /** Another Round of the same shape, gone with the fixture. */
    readonly anotherRound: () => Promise<string>;
  }) => Promise<void>,
) => {
  const client = new SQL(databaseUrl, { max: 3 });
  try {
    await withFixture(databaseUrl, async (f) => {
      const host = await f.actor(await f.user());
      const endedRound = async () =>
        f.round({
          room_id: await f.room(host, await f.format()),
          visibility: 'public',
          room_config_snapshot: {},
          resolution: null,
          status: 'completed',
          competition_type: 'ranked',
          format_id: 'freestyle',
          preset_version: 1,
          ladder_id: 'freestyle',
          outcome: 'affirmative',
          started_at: started,
          completed_at: ended,
        });
      const roundId = await endedRound();
      try {
        await run({
          db: drizzle({ client }),
          sql: client,
          roundId,
          anotherRound: endedRound,
        });
      } finally {
        await client`delete from broadcasts where round_id=${roundId}`;
      }
    });
  } finally {
    await client.close();
  }
};
const rows = (sql: SQL, roundId: string) =>
  sql`select kind, fact_id, captured_at, released_at, watermark_at, basis from spectator_fact_releases where round_id=${roundId}` as Promise<
    {
      kind: string;
      fact_id: string;
      captured_at: Date;
      released_at: Date;
      watermark_at: Date | null;
      basis: string;
    }[]
  >;

test('a fact is logged once it left, with both times, and the first release stands', async () => {
  await withEndedRound(async ({ db, sql, roundId }) => {
    await sql`insert into broadcasts (id, round_id, feed_key, release_policy, released_through_at)
      values (${'b' + roundId.slice(1)}, ${roundId}, ${'k' + roundId.slice(1)}, ${{ kind: 'delay', seconds: delay }}, ${ended})`;
    const far = after(ended, 1000 * delay * 100);
    assert({
      given: 'a watermark short of the margin, long after by the clock',
      should: 'log nothing',
      actual: await recordFactReleases(db, { roundId, clock: clockAt(far) }),
      expected: 0,
    });
    const passed = after(ended, SPECTATOR_MARGIN_MS);
    await sql`update broadcasts set released_through_at=${passed} where round_id=${roundId}`;
    await recordFactReleases(db, { roundId, clock: clockAt(far) });
    const first = await rows(sql, roundId);
    assert({
      given: 'the watermark past the result',
      should: 'log its capture time, release time and the watermark',
      actual: first.map((r) => [
        r.kind,
        r.captured_at.toISOString(),
        r.released_at.toISOString(),
        r.watermark_at?.toISOString(),
        r.basis,
      ]),
      expected: [
        [
          'result',
          ended.toISOString(),
          far.toISOString(),
          passed.toISOString(),
          'watermark',
        ],
      ],
    });
    const later = after(far, 5000);
    assert({
      given: 'the same fact seen again later',
      should: 'add nothing and keep the first release time',
      actual: [
        await recordFactReleases(db, { roundId, clock: clockAt(later) }),
        (await rows(sql, roundId))[0]!.released_at.toISOString(),
      ],
      expected: [0, far.toISOString()],
    });
  });
});

test('the log refuses a change, and goes only with its Round', async () => {
  await withEndedRound(async ({ db, sql, roundId }) => {
    await recordFactReleases(db, {
      roundId,
      clock: clockAt(after(ended, 1000 * delay)),
    });
    const refused = async (run: () => PromiseLike<unknown>) =>
      Promise.resolve(run()).then(
        () => 'applied',
        (error: Error) => error.message,
      );
    assert({
      given: 'an update and a delete of a logged fact',
      should: 'refuse both',
      actual: [
        await refused(
          () =>
            sql`update spectator_fact_releases set released_at=${started} where round_id=${roundId}`,
        ),
        await refused(
          () =>
            sql`delete from spectator_fact_releases where round_id=${roundId}`,
        ),
      ],
      expected: [
        'The spectator fact log is append-only',
        'The spectator fact log is append-only',
      ],
    });
    await sql`delete from rounds where id=${roundId}`;
    assert({
      given: 'the Round itself erased',
      should: 'take its log with it',
      actual: (await rows(sql, roundId)).length,
      expected: 0,
    });
  });
});

test('the sweep finds a Round only while a fact has left and no row records it', async () => {
  await withEndedRound(async ({ db, sql, roundId }) => {
    await sql`insert into broadcasts (id, round_id, feed_key, release_policy, released_through_at, completed_at)
      values (${'b' + roundId.slice(1)}, ${roundId}, ${'k' + roundId.slice(1)}, ${{ kind: 'at', atMs: ended.getTime() + 90 * 86_400_000 }}, ${started}, ${ended})`;
    const found = async (at: Date) =>
      (
        await readRoundsAwaitingFactLog(db, {
          clock: clockAt(at),
          limit: 1000,
        })
      ).includes(roundId);
    const monthLater = after(ended, 30 * 86_400_000);
    const released = after(ended, 90 * 86_400_000);
    assert({
      given: 'a scheduled hold nothing has passed, a month after the Round',
      should: 'not take a place in the pass',
      actual: await found(monthLater),
      expected: false,
    });
    assert({
      given: 'the hold ending three months after the Round',
      should: 'find it however long the hold ran',
      actual: await found(released),
      expected: true,
    });
    await recordFactReleases(db, { roundId, clock: clockAt(released) });
    assert({
      given: 'every released fact recorded',
      should: 'not find it again',
      actual: await found(after(released, 1000)),
      expected: false,
    });
  });
});

test('a full batch of waiting Rounds starves nothing', async () => {
  await withEndedRound(async ({ db, sql, roundId, anotherRound }) => {
    const ids = [roundId, await anotherRound(), await anotherRound()];
    const clock = clockAt(after(ended, 1000 * delay));
    const { sweepSpectatorFactLog } = spectatorFactLogOperations({
      database: db,
    });
    for (let pass = 0; pass < ids.length; pass += 1)
      await sweepSpectatorFactLog({ clock, limit: 1 });
    const logged = await Promise.all(
      ids.map(async (id) => (await rows(sql, id)).length > 0),
    );
    assert({
      given: 'more Rounds waiting than one pass takes',
      should: 'reach every one of them within as many passes',
      actual: logged,
      expected: ids.map(() => true),
    });
  });
});

type PlanNode = {
  readonly 'Node Type': string;
  readonly 'Relation Name'?: string;
  readonly 'Actual Rows'?: number;
  readonly 'Rows Removed by Filter'?: number;
  readonly 'Actual Loops'?: number;
  readonly Plans?: readonly PlanNode[];
};
type PlanRoot = readonly { readonly Plan: PlanNode }[];
const planNodes = (node: PlanNode): readonly PlanNode[] => [
  node,
  ...(node.Plans ?? []).flatMap(planNodes),
];
/** The pass's query with its parameters inlined, for EXPLAIN. */
const sqlText = (
  db: ReturnType<typeof drizzle>,
  input: Parameters<typeof readRoundsAwaitingFactLog>[1],
) => {
  let text = '';
  void readRoundsAwaitingFactLog(
    {
      execute: async (query: Parameters<typeof db.execute>[0]) => {
        const { sql: raw, params } = new PgDialect().sqlToQuery(
          query as SQLType,
        );
        text = raw.replace(/\$(\d+)/g, (_, n) => {
          const value = params[Number(n) - 1];
          return typeof value === 'number'
            ? String(value)
            : `'${String(value)}'`;
        });
        return [];
      },
    } as never,
    input,
  );
  return text;
};

/** Returns once a statement is waiting on an open row's lock; no timing involved. */
const blockedOnOpenRow = async (sql: SQL, triesLeft = 5000): Promise<void> => {
  const waiting = (await sql`select 1 from pg_stat_activity
    where datname=current_database() and wait_event_type='Lock'
      and query like '%spectator_fact_log_open_rounds%'`) as unknown[];
  if (waiting.length > 0) return;
  if (triesLeft === 0)
    throw new Error('No removal ever waited on the open row');
  return blockedOnOpenRow(sql, triesLeft - 1);
};

const openRows = (sql: SQL, roundId: string) =>
  sql`select touched_at from spectator_fact_log_open_rounds where round_id=${roundId}` as Promise<
    unknown[]
  >;

test('a Round leaves the open rows once it is over and logged, and a late fact reopens it', async () => {
  await withEndedRound(async ({ db, sql, roundId }) => {
    const clock = clockAt(after(ended, 1000 * delay));
    const sweep = spectatorFactLogOperations({
      database: db,
    }).sweepSpectatorFactLog;
    assert({
      given: 'an ended Round with an unlogged result',
      should: 'be open',
      actual: (await openRows(sql, roundId)).length,
      expected: 1,
    });
    await sweep({ clock, limit: 10 });
    assert({
      given: 'a pass that logged all of it',
      should: 'close it',
      actual: [
        (await rows(sql, roundId)).map((r) => r.kind),
        (await openRows(sql, roundId)).length,
      ],
      expected: [['result'], 0],
    });
    await sql`update rounds set visibility='private' where id=${roundId}`;
    assert({
      given: 'a Round turning private',
      should: 'open no row',
      actual: (await openRows(sql, roundId)).length,
      expected: 0,
    });
    await sql`update rounds set visibility='public' where id=${roundId}`;
    assert({
      given: 'the same Round public again',
      should: 'reopen, so a pass looks at it',
      actual: (await openRows(sql, roundId)).length,
      expected: 1,
    });
  });
});

test('a fact landing during a removal keeps the Round open', async () => {
  await withEndedRound(async ({ db, sql, roundId }) => {
    await recordFactReleases(db, {
      roundId,
      clock: clockAt(after(ended, 1000 * delay)),
    });
    const writer = await sql.reserve();
    try {
      await writer`begin`;
      // Any of a Round's triggers: it locks and touches the open row, uncommitted.
      await writer`update rounds set visibility='unlisted', audience_link_hash=${'a'.repeat(64)} where id=${roundId}`;
      await writer`update rounds set visibility='public', audience_link_hash=null where id=${roundId}`;
      const removal = closeSettledFactLogRounds(db);
      await blockedOnOpenRow(sql);
      await writer`commit`;
      await removal;
    } finally {
      writer.release();
    }
    assert({
      given: 'a removal that saw an old row while a writer held it',
      should: 'wait for the writer and then leave the row',
      actual: (await openRows(sql, roundId)).length,
      expected: 1,
    });
  });
});

/** Every column of a table but the named ones, for copying a row in bulk. */
const columnsOf = async (sql: SQL, table: string, except: readonly string[]) =>
  (
    (await sql`select column_name from information_schema.columns
      where table_schema='public' and table_name=${table}
        and is_generated='NEVER'`) as { column_name: string }[]
  )
    .map((row) => row.column_name)
    .filter((name) => !except.includes(name))
    .map((name) => `"${name}"`)
    .join(',');

test('the sweep costs nothing for finished Rounds, however many there are', async () => {
  const history = 2000;
  await withEndedRound(async ({ db, sql, roundId }) => {
    const prefix = `${roundId.slice(0, 16)}`;
    const roomColumns = await columnsOf(sql, 'rooms', ['id']);
    const roundColumns = await columnsOf(sql, 'rounds', ['id', 'room_id']);
    const [source] =
      (await sql`select room_id from rounds where id=${roundId}`) as {
        room_id: string;
      }[];
    const roomId = source!.room_id;
    const ids = `generate_series(1, ${history}) n`;
    const copied = (n: string) => `'${prefix}' || lpad(${n}::text, 8, '0')`;
    try {
      await sql.unsafe(`insert into rooms (id, ${roomColumns})
        select ${copied('n')}, ${roomColumns} from rooms, ${ids} where rooms.id='${roomId}'`);
      await sql.unsafe(`insert into rounds (id, room_id, ${roundColumns})
        select ${copied('n')}, ${copied('n')}, ${roundColumns} from rounds, ${ids} where rounds.id='${roundId}'`);
      const clock = clockAt(after(ended, 1000 * delay));
      const { sweepSpectatorFactLog } = spectatorFactLogOperations({
        database: db,
      });
      await sweepSpectatorFactLog({ clock, limit: history * 2 });
      const [open] =
        (await sql`select count(*)::int as n from spectator_fact_log_open_rounds`) as {
          n: number;
        }[];
      assert({
        given: `${history} finished Rounds, every fact logged by one pass`,
        should: 'leave none of them open',
        actual: open!.n,
        expected: 0,
      });
      await sql`analyze rounds`;
      await sql`analyze spectator_fact_log_open_rounds`;
      const candidates = sqlText(db, { clock, limit: 256 });
      const scanOfRounds = async () => {
        const [plan] = (await sql.unsafe(
          `explain (analyze, format json) ${candidates}`,
        )) as { 'QUERY PLAN': PlanRoot }[];
        const nodes = planNodes(plan!['QUERY PLAN'][0]!.Plan);
        const ofRounds = nodes.filter((n) => n['Relation Name'] === 'rounds');
        return {
          fromOpenRows: nodes.some(
            (n) => n['Relation Name'] === 'spectator_fact_log_open_rounds',
          ),
          seqScan: ofRounds.some((n) => n['Node Type'] === 'Seq Scan'),
          read: ofRounds.reduce(
            (sum, n) =>
              sum +
              ((n['Actual Rows'] ?? 0) + (n['Rows Removed by Filter'] ?? 0)) *
                (n['Actual Loops'] ?? 0),
            0,
          ),
        };
      };
      assert({
        given: 'the pass over those finished Rounds',
        should: 'start from the open rows and read no Round at all',
        actual: await scanOfRounds(),
        expected: { fromOpenRows: true, seqScan: false, read: 0 },
      });
      await sql`update rounds set visibility='private' where id=${roundId}`;
      await sql`update rounds set visibility='public' where id=${roundId}`;
      assert({
        given: 'one of them reopened, among the same history (control)',
        should: 'read that one Round alone',
        actual: await scanOfRounds(),
        expected: { fromOpenRows: true, seqScan: false, read: 1 },
      });
    } finally {
      await sql.unsafe(
        `delete from rounds where id like '${prefix}%' and id <> '${roundId}'`,
      );
      await sql.unsafe(
        `delete from rooms where id like '${prefix}%' and id <> '${roomId}'`,
      );
    }
  });
});

test('a released resolution is logged at the Round start', async () => {
  await withEndedRound(async ({ db, sql, roundId }) => {
    await sql`update rounds set resolution='Resolved, a line' where id=${roundId}`;
    await recordFactReleases(db, {
      roundId,
      clock: clockAt(after(ended, 1000 * delay)),
    });
    assert({
      given: 'a Round with a resolution, its start long released',
      should: 'log the resolution, captured when the Round started',
      actual: (await rows(sql, roundId))
        .filter((r) => r.kind === 'resolution')
        .map((r) => [r.fact_id, r.captured_at.toISOString()]),
      expected: [[roundId, started.toISOString()]],
    });
  });
});

test('a ranked Round with no Broadcast leaves by the clock, and the log says so', async () => {
  await withEndedRound(async ({ db, sql, roundId }) => {
    assert({
      given: 'no Broadcast, before completion plus the ranked delay',
      should: 'log nothing',
      actual: await recordFactReleases(db, {
        roundId,
        clock: clockAt(after(ended, 1000 * delay - 1)),
      }),
      expected: 0,
    });
    await recordFactReleases(db, {
      roundId,
      clock: clockAt(after(ended, 1000 * delay)),
    });
    assert({
      given: 'the ranked delay passed with no Broadcast',
      should: 'log it as a clock fallback, with no watermark',
      actual: (await rows(sql, roundId)).map((r) => [
        r.kind,
        r.basis,
        r.watermark_at,
      ]),
      expected: [['result', 'clock_fallback', null]],
    });
  });
});
