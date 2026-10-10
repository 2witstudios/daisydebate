import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assemblySnapshot } from './assembly.test-support';
import { readAssembly, readRoomList } from './read-assembly';

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
  length,
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
  length,
  seated: true,
  roundRef: null,
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
      { kind: 'found', view: assemblySnapshot },
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
