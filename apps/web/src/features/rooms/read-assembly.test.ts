import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assemblySnapshot } from './assembly.test-support';
import { readActiveRoom, readAssembly, readRoomList } from './read-assembly';

setupRitewayBun();
const {
  id,
  version,
  title,
  topic,
  visibility,
  hostActorId,
  hostLabel,
  status,
  competitionType,
} = assemblySnapshot;
const listingEntry = {
  id,
  version,
  title,
  topic,
  visibility,
  hostActorId,
  hostLabel,
  status,
  competitionType,
  seated: true,
  roundRef: null,
  formatLabel: 'Foundation',
  seatsTaken: 1,
  seatCount: 2,
  waitingSince: '2026-10-09T00:00:00.000Z',
  live: null,
  hostRating: null,
};

test('canonical room reads reject malformed or substituted projections', async () => {
  const results = [];
  for (const body of [
    assemblySnapshot,
    { ...assemblySnapshot, id: 'z'.repeat(24) },
    { ...assemblySnapshot, previewToken: 'unexpected' },
  ]) {
    results.push(
      await readAssembly(async () => Response.json(body), assemblySnapshot.id),
    );
  }
  assert({
    given:
      'a stored Room, substituted identity and unexpected preview authority',
    should: 'render only the exact validated canonical projection',
    actual: results,
    expected: [
      { kind: 'found', view: assemblySnapshot, socketUrl: null },
      { kind: 'unavailable' },
      { kind: 'unavailable' },
    ],
  });
});

test('list uses canonical projections and never substitutes sample rooms during an outage', async () => {
  const results = [];
  for (const response of [
    Response.json({ rooms: [listingEntry], nextCursor: null, retry: false }),
    Response.json({ rooms: [], nextCursor: null, retry: false }),
    new Response(null, { status: 503 }),
  ])
    results.push(
      await readRoomList(async () => response, { pageSize: 20, q: '' }),
    );
  assert({
    given:
      'a persisted listing, authoritative empty listing and unavailable service',
    should: 'keep those three outcomes distinct',
    actual: results,
    expected: [
      { kind: 'found', rooms: [listingEntry], nextCursor: null, retry: false },
      { kind: 'found', rooms: [], nextCursor: null, retry: false },
      { kind: 'unavailable' },
    ],
  });
});

test('discovery consumer rejects overflow and substituted cursor order without truncation', async () => {
  const low = { ...listingEntry, id: 'a'.repeat(24) },
    high = { ...listingEntry, id: 'b'.repeat(24) };
  const results = [];
  for (const body of [
    { rooms: [low, high], nextCursor: null, retry: false },
    { rooms: [low], nextCursor: high.id, retry: false },
    { rooms: [high, low], nextCursor: null, retry: false },
    { rooms: [low, low], nextCursor: null, retry: false },
  ])
    results.push(
      (
        await readRoomList(async () => Response.json(body), {
          pageSize: 1,
          q: '',
          cursor: low.id,
        })
      ).kind,
    );
  assert({
    given: 'an over-budget or nonprogressing/substituted producer page',
    should: 'refuse the entire response without silently truncating',
    actual: results,
    expected: Array(4).fill('unavailable'),
  });
});

test('a room read names the realtime endpoint its doorbell rings on', async () => {
  const read = (headers: Record<string, string>) =>
    readAssembly(
      async () => Response.json(assemblySnapshot, { headers }),
      assemblySnapshot.id,
    );
  assert({
    given:
      'a read with a realtime endpoint header, one without, and one with a malformed endpoint',
    should: 'return the endpoint, then none, then none rather than trust it',
    actual: [
      await read({
        'x-realtime-socket-url': 'wss://socket.daisy.invalid/realtime',
      }),
      await read({}),
      await read({ 'x-realtime-socket-url': 'javascript:alert(1)' }),
    ].map((result) =>
      result.kind === 'found' ? result.socketUrl : result.kind,
    ),
    expected: ['wss://socket.daisy.invalid/realtime', null, null],
  });
});

test('the active room read shows only a canonical own Room', async () => {
  const activeRoom = {
    version: 1,
    id: 'm'.repeat(24),
    title: 'Current room',
    phase: 'assembling',
    role: 'host',
    href: `/rooms/${'m'.repeat(24)}`,
  };
  const calls: string[] = [];
  const read = (response: Response) =>
    readActiveRoom(async (path) => {
      calls.push(path);
      return response;
    });
  assert({
    given:
      'a held Room, no Room, inert Room routes, a refusal and a malformed answer',
    should:
      'show the held Room from the canonical route and show none otherwise',
    actual: [
      await read(Response.json({ activeRoom })),
      await read(Response.json({ activeRoom: null })),
      await read(new Response(null, { status: 404 })),
      await read(new Response(null, { status: 429 })),
      await read(Response.json({ activeRoom: { ...activeRoom, href: '/x' } })),
      [...new Set(calls)],
    ],
    expected: [activeRoom, null, null, null, null, ['/api/rooms/active']],
  });
});

test('the listing read forwards the Lobby filters to the canonical route', async () => {
  const paths: string[] = [];
  await readRoomList(
    async (path) => {
      paths.push(path);
      return Response.json({ rooms: [], nextCursor: null, retry: false });
    },
    { pageSize: 20, q: '', status: 'starting', mode: 'casual' },
  );
  assert({
    given: 'a starting, casual Lobby filter',
    should: 'name both on the canonical listing request',
    actual: new URL(
      paths[0]!,
      'https://in-process.invalid',
    ).searchParams.toString(),
    expected: 'q=&pageSize=20&status=starting&mode=casual',
  });
});
