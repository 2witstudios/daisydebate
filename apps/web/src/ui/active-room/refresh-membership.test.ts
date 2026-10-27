import { assert, setupRitewayBun, test } from 'riteway/bun';
import { refreshActiveRoom } from './refresh-membership';

setupRitewayBun();

test('membership refresh reads only the canonical membership projection', async () => {
  const calls: unknown[] = [];
  const rooms: unknown[] = [];
  const controller = new AbortController();
  await refreshActiveRoom(
    async (path, init) => {
      calls.push([
        path,
        init.method,
        init.cache,
        init.signal === controller.signal,
      ]);
      return Response.json({ activeRoom: null });
    },
    controller.signal,
    (room) => rooms.push(room),
  );
  assert({
    given: 'a closed Room while its retained shell still carries membership',
    should: 'clear only the membership using an uncached canonical read',
    actual: { calls, rooms },
    expected: {
      calls: [['/api/rooms/active', 'GET', 'no-store', true]],
      rooms: [null],
    },
  });
});

test('a previous location cannot replace the current location membership', async () => {
  const old = Promise.withResolvers<Response>();
  const oldController = new AbortController();
  const rooms: unknown[] = [];
  const pending = refreshActiveRoom(
    () => old.promise,
    oldController.signal,
    (room) => rooms.push(room),
  );
  oldController.abort();
  await refreshActiveRoom(
    async () => Response.json({ activeRoom: null }),
    new AbortController().signal,
    (room) => rooms.push(room),
  );
  old.resolve(
    Response.json({
      activeRoom: {
        version: 1,
        id: 'm'.repeat(24),
        title: 'Old room',
        phase: 'assembling',
        role: 'host',
        href: `/rooms/${'m'.repeat(24)}`,
      },
    }),
  );
  await pending;
  assert({
    given: 'a delayed old read after navigation or Activity disconnect',
    should: 'retain the current empty membership when the old answer arrives',
    actual: rooms,
    expected: [null],
  });
});
