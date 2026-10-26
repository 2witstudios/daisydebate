import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { discoverRooms } from '../src/room-discovery';
import { withFixture } from './constraint-helpers';
import { createAuthorizationSubject } from './authorization.test-support';
import { validConfig, validRules } from './round-fixtures';
import { integrationSuite } from './suite.test-support';

requireTestServices(process.env);
setupRitewayBun();
const { databaseUrl } = integrationSuite();

for (const sort of ['longest-waiting', 'newest'] as const)
  test(`${sort} discovery survives a cursor Room launching and a new Room arriving`, async () =>
    withFixture(databaseUrl, async (f) => {
      const caller = await createAuthorizationSubject(f);
      const formatId = await f.format();
      const token = createId();
      const ids = Array.from({ length: 5 }, () => createId()).sort();
      const add = async (index: number, microsecond: number) => {
        const id = ids[index]!;
        await f.insert('rooms', {
          id,
          host_actor_id: caller.actorId,
          title: token,
          topic: token,
          visibility: 'public',
          format_id: formatId,
          format_version: 1,
          competition_type: 'casual',
          config: validConfig,
          execution_plan: {},
          rules_snapshot: validRules,
          status: 'assembling',
        });
        const at = `2026-01-01T00:00:00.00000${microsecond}Z`;
        await f.sql`update rooms set created_at=${at}::timestamptz where id=${id}`;
      };
      // Creation order disagrees with random IDs, and two rows share a timestamp.
      for (const [index, microsecond] of [
        [0, 2],
        [1, 1],
        [2, 1],
        [3, 3],
      ])
        await add(index!, microsecond!);
      const db = drizzle({ client: f.sql });
      const list = (cursor?: string) =>
        db.transaction((tx) =>
          discoverRooms(
            tx,
            caller,
            { sort, q: token, pageSize: 2, ...(cursor ? { cursor } : {}) },
            () => true,
            () => true,
            () => false,
          ),
        );
      const first = await list();
      const anchor = first.nextCursor!;
      await f.round({
        room_id: anchor,
        format_id: formatId,
        room_config_snapshot: validConfig,
        visibility: 'public',
        status: 'scheduled',
      });
      await f.sql`update rooms set status='started' where id=${anchor}`;
      await add(4, 4);
      const second = await list(anchor);
      const third = second.nextCursor ? await list(second.nextCursor) : null;
      assert({
        given:
          'microsecond timestamps, tied creation times and a launched cursor anchor',
        should:
          'retain exact tuple order without repeating a Room across discovery branches',
        actual: [
          first.rooms.map((room) => room.id),
          second.rooms.map((room) => room.id),
          third?.rooms.map((room) => room.id) ?? [],
        ],
        expected:
          sort === 'longest-waiting'
            ? [[ids[1], ids[2]], [ids[0], ids[3]], [ids[4]]]
            : [[ids[3], ids[0]], [ids[2], ids[1]], []],
      });
    }));
