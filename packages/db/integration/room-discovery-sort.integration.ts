import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { finishedOrBlockedBehind } from '../src/testing';
import { createAuthorizationSubject } from './authorization.test-support';
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
          status: 'opening',
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

test('discovery never continues from a Room made unlisted during its lock wait', async () =>
  withDiscoveryFixture(async ({ f, formatId, token, nextId, list }) => {
    const host = await createAuthorizationSubject(f);
    const first = nextId();
    const second = nextId();
    const third = nextId();
    for (const [index, id] of [first, second, third].entries())
      await f.room(host.actorId, formatId, {
        id,
        title: token,
        topic: token,
        created_at: new Date(Date.UTC(2026, 0, 1, 0, index)),
      });
    const read = () => list({ sort: 'longest-waiting', q: token, pageSize: 2 });
    const changeWhileReading = async (ids: readonly string[]) => {
      let pending: ReturnType<typeof read> | undefined;
      try {
        await f.sql.begin(async (writer) => {
          const [{ pid }] = await writer`select pg_backend_pid() as pid`;
          for (const id of ids)
            await writer`update rooms set visibility = 'unlisted' where id = ${id}`;
          pending = read();
          assert({
            given: 'the visibility change is still uncommitted',
            should: 'block the page read behind the Room writer',
            actual: await finishedOrBlockedBehind(pending, f.sql, pid, {
              now: Date.now,
            }),
            expected: 'blocked',
          });
        });
      } finally {
        await pending?.catch(() => undefined);
      }
      if (!pending) throw new Error('Discovery did not start');
      return pending;
    };
    const shorter = await changeWhileReading([second]);
    await f.sql`update rooms set visibility = 'public' where id = ${second}`;
    const empty = await changeWhileReading([first, second]);
    assert({
      given: 'one or both selected Rooms became inaccessible mid-read',
      should:
        'advance only from the last visible Room, or explicitly request a retry',
      actual: [shorter, empty].map(({ rooms, nextCursor, retry }) => ({
        ids: rooms.map(({ id }) => id),
        nextCursor,
        retry,
      })),
      expected: [
        { ids: [first], nextCursor: first, retry: false },
        { ids: [], nextCursor: null, retry: true },
      ],
    });
    await assertRejects({
      given: 'an oversized discovery request',
      should: 'refuse it with validation',
      actual: () => list({ pageSize: 51, q: token }),
      code: 'VALIDATION',
    });
  }));
