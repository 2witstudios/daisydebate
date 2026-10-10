import { requireTestServices } from '@daisy/config';
import { assert, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { resolve } from 'node:path';
import { runMigrations } from '../src/migrator';
import { discoverRooms } from '../src/room-discovery';
import { withFixture } from './constraint-helpers';
import { createAuthorizationSubject } from './authorization.test-support';
import { validConfig, validRules } from './round-fixtures';
import { integrationSuite } from './suite.test-support';
requireTestServices(process.env);
const { databaseUrl } = integrationSuite();

test('discovery uses partial ordered indexes independently of historical Room and Round volume', async () => {
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
    const caller = await createAuthorizationSubject(f);
    const formatId = await f.format();
    const token = createId();
    const ids = Array.from(
      { length: 6 },
      (_, i) => `d${String(i).padStart(23, '0')}`,
    );
    for (const [i, id] of ids.entries()) {
      await f.insert('rooms', {
        id,
        host_actor_id: caller.actorId,
        title: token,
        topic: token,
        visibility: 'public',
        format_id: formatId,
        format_version: 1,
        competition_type: 'casual',
        length: 'full',
        config: validConfig,
        execution_plan: {},
        rules_snapshot: validRules,
        status: i < 2 ? 'assembling' : i === 5 ? 'abandoned' : 'started',
        created_at: new Date('2026-01-01'),
      });
      if (i >= 2 && i < 5)
        await f.round({
          room_id: id,
          format_id: formatId,
          room_config_snapshot: validConfig,
          visibility: 'public',
          status: i === 4 ? 'abandoned' : 'scheduled',
          ...(i === 4 ? { completed_at: new Date('2026-01-01') } : {}),
        });
    }
    // Earlier keys ensure a historical PK scan cannot hide behind LIMIT.
    const historyIds = Array.from({ length: 2000 }, () => createId());
    const liveIds = Array.from(
      { length: 200 },
      (_, i) => `z${String(i).padStart(23, '0')}`,
    );
    const liveArray = `{${liveIds.join(',')}}`;
    const historyArray = `{${historyIds.join(',')}}`;
    const addHistory = async (array: string) => {
      await f.sql`insert into rooms(id,host_actor_id,title,topic,visibility,format_id,format_version,competition_type,length,config,execution_plan,rules_snapshot,status)
        select x,${caller.actorId},${token},${token},'public',${formatId},1,'casual','full',${validConfig}::jsonb,'{}'::jsonb,${validRules}::jsonb,'started' from unnest(${array}::text[]) x`;
      await f.sql`insert into rounds(id,room_id,resolution,competition_type,length,format_id,format_version,rules_snapshot,status,room_config_snapshot,visibility,completed_at)
        select 'r'||substr(x,2),x,${token},'casual','full',${formatId},1,${validRules}::jsonb,'abandoned',${validConfig}::jsonb,'public',statement_timestamp() from unnest(${array}::text[]) x`;
    };
    try {
      await addHistory(`{${historyIds.slice(0, 1000).join(',')}}`);
      await f.sql`insert into rooms(id,host_actor_id,title,topic,visibility,format_id,format_version,competition_type,length,config,execution_plan,rules_snapshot,status)
        select x,${caller.actorId},${token},${token},'public',${formatId},1,'casual','full',${validConfig}::jsonb,'{}'::jsonb,${validRules}::jsonb,case when right(x,1) in ('0','2','4','6','8') then 'assembling' else 'started' end from unnest(${liveArray}::text[]) x`;
      await f.sql`insert into rounds(id,room_id,resolution,competition_type,length,format_id,format_version,rules_snapshot,status,room_config_snapshot,visibility)
        select 'y'||substr(x,2),x,${token},'casual','full',${formatId},1,${validRules}::jsonb,'scheduled',${validConfig}::jsonb,'public' from unnest(${liveArray}::text[]) x where right(x,1) in ('1','3','5','7','9')`;
      await f.sql`analyze rooms`;
      await f.sql`analyze rounds`;
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
            { q: token, pageSize: 2, ...(cursor ? { cursor } : {}) },
            () => true,
            () => true,
          ),
        );
      const first = await list(),
        second = await list(first.nextCursor!);
      assert({
        given:
          'tied creation timestamps, assemblies, live started Rooms and 2000 historical pairs',
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
          ['scheduled', 'scheduled'],
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
      const before = await explain(1000);
      await addHistory(`{${historyIds.slice(1000).join(',')}}`);
      await f.sql`analyze rooms`;
      await f.sql`analyze rounds`;
      const after = await explain(2000);
      const plan = JSON.stringify(after);
      assert({
        given:
          'historical Room/Round count doubles while live candidates remain fixed',
        should:
          'examine the same bounded candidate count with stable buffer work',
        actual: [
          before['Actual Rows'],
          after['Actual Rows'],
          after['Shared Hit Blocks'] <= before['Shared Hit Blocks'] + 10,
        ],
        expected: [3, 3, true],
      });
      assert({
        given:
          'the actual discovery query under default planner settings and earlier historical keys',
        should:
          'use both partial indexes without scanning history or aggregate tables',
        actual: [
          queries.filter((q) => q.query.trim().startsWith('select')).length,
          plan.includes('rooms_discovery_assembly_idx'),
          plan.includes('rounds_discovery_live_room_idx'),
          queries.some((q) =>
            /format_revisions|readiness_command_id/.test(q.query),
          ),
          queries
            .filter((q) => q.query.includes('for share'))
            .every((q) => q.params.length <= 2),
        ],
        expected: [14, true, true, false, true],
      });
    } finally {
      await f.sql`delete from rounds where room_id=any(${historyArray}::text[]) or room_id=any(${liveArray}::text[])`;
      await f.sql`delete from rooms where id=any(${historyArray}::text[]) or id=any(${liveArray}::text[])`;
    }
  });
});
