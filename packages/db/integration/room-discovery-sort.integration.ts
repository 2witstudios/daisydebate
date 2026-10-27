import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withDiscoveryFixture } from './room-discovery.test-support';

requireTestServices(process.env);
setupRitewayBun();

for (const sort of ['longest-waiting', 'newest'] as const)
  test(`${sort} discovery survives a cursor Room launching and a new Room arriving`, async () =>
    withDiscoveryFixture(
      async ({ f, caller, formatId, token, nextId, config, list: query }) => {
        const ids = Array.from({ length: 5 }, () => nextId()).sort();
        const add = async (index: number, microsecond: number) => {
          const id = ids[index]!;
          await f.room(caller.actorId, formatId, {
            id,
            title: token,
            topic: token,
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
        const list = (cursor?: string) =>
          query({
            sort,
            q: token,
            pageSize: 2,
            ...(cursor ? { cursor } : {}),
          });
        const first = await list();
        const anchor = first.nextCursor!;
        await f.round({
          room_id: anchor,
          format_id: formatId,
          room_config_snapshot: config,
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
      },
    ));
