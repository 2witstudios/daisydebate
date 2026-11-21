import { publicLobbyId } from '../src/daisy-reference';
import { requireTestServices } from '@daisy/config';
import { emptyRuntimeCheckpointFor } from '@daisy/protocol';
import { assert, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { resolve } from 'node:path';
import { runMigrations } from '../src/migrator';
import { discoverRooms } from '../src/room-discovery';
import {
  discoveryRelationBuffers,
  discoveryRelationWork,
} from '../src/room-discovery-plan.test-support';
import { withFixture } from './constraint-helpers';
import { createAuthorizationSubject } from './authorization.test-support';
import { validConfig, validRules } from './round-fixtures';
import { integrationSuite } from './suite.test-support';
requireTestServices(process.env);
const { databaseUrl } = integrationSuite();

test('reapplying the committed migration chain records no new migrations', async () => {
  await withFixture(databaseUrl, async (f) => {
    const folder = resolve(import.meta.dir, '../migrations');
    const [initial] =
      await f.sql`select count(*)::int n from drizzle.__drizzle_migrations`;
    for (let i = 0; i < 2; i++)
      await runMigrations({ databaseUrl, migrationsFolder: folder });
    const [reapplied] =
      await f.sql`select count(*)::int n from drizzle.__drizzle_migrations`;
    assert({
      given: 'this run already applied the whole forward chain',
      should: 'apply twice again without duplicate migration records',
      actual: reapplied!.n,
      expected: initial!.n,
    });
  });
});

// ISSUE-1435: the proof is the plan's Room/Round work, not wall-clock. The
// seed is kept small because its insert and FK-checked delete dominate the
// runtime; 300 per step is 3x the size (100) at which the default planner
// legitimately prefers scanning the smaller table. With every index scan
// disabled the plan examines ~1000 rows against a bound of 36, so the seed
// still exposes a history scan. Measured 0.9-1.1 s idle and up to 1.9 s at
// load average 24; the 10 s budget leaves 5x that for loaded CI hosts.
const HISTORY_PER_STEP = 300;
const LIVE = 20;

test('discovery work is independent of historical Room and Round volume', async () => {
  await withFixture(databaseUrl, async (f) => {
    const caller = await createAuthorizationSubject(f);
    const formatId = await f.format();
    const token = createId();
    const ids = Array.from(
      { length: 6 },
      (_, i) => `d${String(i).padStart(23, '0')}`,
    );
    for (const [i, id] of ids.entries()) {
      await f.room(caller.actorId, formatId, {
        id,
        title: token,
        topic: token,
        status: i < 2 ? 'assembling' : i === 5 ? 'closed' : 'started',
        created_at: new Date('2026-01-01'),
      });
      if (i >= 2 && i < 5)
        await f.round({
          room_id: id,
          format_id: formatId,
          room_config_snapshot: validConfig,
          visibility: 'public',
          status: i === 4 ? 'abandoned' : 'opening',
          ...(i === 4 ? { completed_at: new Date('2026-01-01') } : {}),
        });
    }
    // Earlier keys ensure a historical PK scan cannot hide behind LIMIT.
    const historyIds = Array.from({ length: 2 * HISTORY_PER_STEP }, () =>
      createId(),
    );
    const liveIds = Array.from(
      { length: LIVE },
      (_, i) => `z${String(i).padStart(23, '0')}`,
    );
    const liveArray = `{${liveIds.join(',')}}`;
    const historyArray = `{${historyIds.join(',')}}`;
    const addHistory = async (array: string) => {
      await f.sql`insert into rooms(lobby_id,id,host_actor_id,title,topic,visibility,format_id,format_version,competition_type,config,execution_plan,rules_snapshot,status)
        select ${publicLobbyId},x,${caller.actorId},${token},${token},'public',${formatId},1,'casual',${validConfig}::jsonb,'{}'::jsonb,${validRules}::jsonb,'started' from unnest(${array}::text[]) x`;
      await f.sql`insert into rounds(id,room_id,resolution,competition_type,format_id,format_version,rules_snapshot,runtime_state,status,room_config_snapshot,visibility,completed_at)
        select 'r'||substr(x,2),x,${token},'casual',${formatId},1,${validRules}::jsonb,${emptyRuntimeCheckpointFor(validRules)}::jsonb,'abandoned',${validConfig}::jsonb,'public',statement_timestamp() from unnest(${array}::text[]) x`;
    };
    try {
      await addHistory(`{${historyIds.slice(0, HISTORY_PER_STEP).join(',')}}`);
      await f.sql`insert into rooms(lobby_id,id,host_actor_id,title,topic,visibility,format_id,format_version,competition_type,config,execution_plan,rules_snapshot,status)
        select ${publicLobbyId},x,${caller.actorId},${token},${token},'public',${formatId},1,'casual',${validConfig}::jsonb,'{}'::jsonb,${validRules}::jsonb,case when right(x,1) in ('0','2','4','6','8') then 'assembling' else 'started' end from unnest(${liveArray}::text[]) x`;
      await f.sql`insert into rounds(id,room_id,resolution,competition_type,format_id,format_version,rules_snapshot,runtime_state,status,room_config_snapshot,visibility)
        select 'y'||substr(x,2),x,${token},'casual',${formatId},1,${validRules}::jsonb,${emptyRuntimeCheckpointFor(validRules)}::jsonb,'opening',${validConfig}::jsonb,'public' from unnest(${liveArray}::text[]) x where right(x,1) in ('1','3','5','7','9')`;
      await f.sql`vacuum (analyze) rooms`;
      await f.sql`vacuum (analyze) rounds`;
      const queries: { query: string; params: unknown[] }[] = [];
      const db = drizzle({
        client: f.sql,
        logger: {
          logQuery(query, params) {
            queries.push({ query, params });
          },
        },
      });
      const list = (cursor?: string) =>
        db.transaction((tx) =>
          discoverRooms(
            tx,
            caller,
            {
              q: token,
              pageSize: 2,
              sort: 'longest-waiting',
              ...(cursor ? { cursor } : {}),
            },
            () => true,
            () => true,
            () => false,
            { now: new Date().toISOString(), rankedDelaySeconds: 0 },
            () => null,
          ),
        );
      const first = await list(),
        second = await list(first.nextCursor!);
      assert({
        given:
          'tied creation timestamps, assemblies, live started Rooms and historical pairs',
        should:
          'page by unique Room id preserving live Round links and excluding history',
        actual: [
          first.rooms.map((r) => r.id),
          second.rooms.map((r) => r.id),
          second.rooms.map((r) => r.roundRef?.status),
          first.nextCursor,
          second.nextCursor,
        ],
        expected: [
          ids.slice(0, 2),
          ids.slice(2, 4),
          ['opening', 'opening'],
          ids[1],
          ids[3],
        ],
      });
      const candidate = queries.find((q) => q.query.includes('union all'))!;
      const explain = async (history: number) => {
        const [explained] = await f.sql.unsafe(
          `explain (analyze,buffers,format json) ${candidate.query}`,
          candidate.params,
        );
        process.stdout.write(
          `DISCOVERY_EXPLAIN history=${history} ${JSON.stringify(explained)}\n`,
        );
        return explained['QUERY PLAN'][0].Plan;
      };
      const before = await explain(HISTORY_PER_STEP);
      await addHistory(`{${historyIds.slice(HISTORY_PER_STEP).join(',')}}`);
      await f.sql`vacuum (analyze) rooms`;
      await f.sql`vacuum (analyze) rounds`;
      const after = await explain(2 * HISTORY_PER_STEP);
      // Each branch has LIVE / 2 + 2 active entries; live entries each join one
      // Room. Count filtered rows and loops too, so a history scan (at least
      // HISTORY_PER_STEP rows, well above this bound) cannot hide behind LIMIT.
      const activeWorkBound = 3 * (liveIds.length / 2 + 2);
      // Room/Round scan pages, index walks included, measured 49 then 47 on a
      // fresh run database. Doubling history adds about 1-3 index leaf pages
      // per step, so the slack stays below that: a walk over the new entries
      // fails. The whole plan's pages (101 then 99) keep a looser bound so a
      // history-proportional probe of any other joined table also fails.
      const pages = (plan: typeof before) =>
        (plan['Shared Hit Blocks'] ?? 0) + (plan['Shared Read Blocks'] ?? 0);
      assert({
        given:
          'historical Room/Round count doubles while live candidates remain fixed',
        should:
          'examine the same bounded candidate count with stable buffer work',
        actual: [
          before['Actual Rows'],
          after['Actual Rows'],
          discoveryRelationBuffers(after) <=
            discoveryRelationBuffers(before) + 1,
          pages(after) <= pages(before) + 10,
        ],
        expected: [3, 3, true, true],
      });
      assert({
        given:
          'the actual discovery query under default planner settings and earlier historical keys',
        should:
          'stay within active-set work without scanning history or aggregate tables',
        actual: [
          queries.filter((q) => q.query.trim().startsWith('select')).length,
          discoveryRelationWork(before) <= activeWorkBound,
          discoveryRelationWork(after) <= activeWorkBound,
          queries.some((q) =>
            /format_revisions|readiness_command_id/.test(q.query),
          ),
          queries
            .filter((q) => q.query.includes('for share'))
            .every((q) => q.params.length <= 2),
        ],
        // Each page reads the official lobby catalog and the caller's age for its default.
        expected: [16, true, true, false, true],
      });
    } finally {
      await f.sql`delete from rounds where room_id=any(${historyArray}::text[]) or room_id=any(${liveArray}::text[])`;
      await f.sql`delete from rooms where id=any(${historyArray}::text[]) or id=any(${liveArray}::text[])`;
    }
  });
}, 10_000);
