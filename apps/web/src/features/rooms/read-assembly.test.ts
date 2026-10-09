import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assemblySnapshot } from './assembly.test-support';
import { readAssembly, readAssemblyList } from './read-assembly';

setupRitewayBun();

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
    Response.json({ rooms: [assemblySnapshot] }),
    Response.json({ rooms: [] }),
    new Response(null, { status: 503 }),
  ])
    results.push(await readAssemblyList(async () => response));
  assert({
    given:
      'a persisted listing, authoritative empty listing and unavailable service',
    should: 'keep those three outcomes distinct',
    actual: results,
    expected: [
      { kind: 'found', rooms: [assemblySnapshot] },
      { kind: 'found', rooms: [] },
      { kind: 'unavailable' },
    ],
  });
});
