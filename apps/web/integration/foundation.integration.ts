import { afterAll, expect, test } from 'bun:test';
import { SQL } from 'bun';

// The proof gate must be open before the first getResources() call builds the
// process resources; production configuration still refuses this combination.
process.env.FOUNDATION_PROOF_ENABLED = 'true';
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl)
  throw new Error(
    'TEST_DATABASE_URL required; never use application database for tests',
  );
if (!new URL(testDatabaseUrl).pathname.endsWith('_test'))
  throw new Error('Test database name must end in _test');
// The vertical exercises the app's own resource graph, so point it at the
// validated test database before the first getResources() call.
process.env.DATABASE_URL = testDatabaseUrl;

const { POST, GET } = await import('../src/app/api/foundation/proof/route');
const { getResources, closeResources } =
  await import('../src/server/resources');

const origin = getResources().config.PUBLIC_APP_URL;
const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(
    new Request(`${origin}/api/foundation/proof`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin,
        ...headers,
      },
      body: JSON.stringify(body),
    }),
  );
const fetchById = (id: string) =>
  GET(new Request(`${origin}/api/foundation/proof?id=${id}`));

const createdIds: string[] = [];

test('proof vertical: validated create, durable store, restored read', async () => {
  const created = await post({ resolution: '  Integration proof  ' });
  expect(created.status).toBe(201);
  const snapshot = (await created.json()) as {
    version: number;
    id: string;
    resolution: string;
    phase: string;
    participants: unknown[];
  };
  createdIds.push(snapshot.id);
  expect(snapshot.version).toBe(1);
  expect(snapshot.resolution).toBe('Integration proof');
  expect(snapshot.phase).toBe('waiting');
  expect(snapshot.participants).toEqual([]);
  expect(created.headers.get('x-request-id')).toBeTruthy();

  const loaded = await fetchById(snapshot.id);
  expect(loaded.status).toBe(200);
  const restored = (await loaded.json()) as { id: string; phase: string };
  expect(restored.id).toBe(snapshot.id);
  expect(restored.phase).toBe('waiting');
});

test('proof vertical rejects invalid, cross-origin, and unknown requests', async () => {
  const tooLong = await post({ resolution: 'x'.repeat(501) });
  expect(tooLong.status).toBe(400);
  expect(
    ((await tooLong.json()) as { error: { code: string } }).error.code,
  ).toBe('VALIDATION');

  const crossOrigin = await POST(
    new Request(`${origin}/api/foundation/proof`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://evil.example',
      },
      body: JSON.stringify({ resolution: 'hostile' }),
    }),
  );
  expect(crossOrigin.status).toBe(403);

  const missing = await fetchById('m4n6p8r2t4v6x8z1k3b5c7d9');
  expect(missing.status).toBe(404);
  expect(
    ((await missing.json()) as { error: { code: string } }).error.code,
  ).toBe('NOT_FOUND');

  const malformed = await fetchById('not-a-cuid2-identifier');
  expect(malformed.status).toBe(400);
});

test('proof route reads legacy UUID identifiers without reminting them', async () => {
  // Durable pre-cuid2 debates keep canonical lowercase UUID identities; the
  // route must treat the legacy shape as valid and resolve it against storage
  // (404 for an unknown record), not reject it as malformed (400).
  const legacyId = '0f0e6d1c-2b3a-4455-9a8b-7c6d5e4f3a21';
  const unknownLegacy = await fetchById(legacyId);
  expect(unknownLegacy.status).toBe(404);
  expect(
    ((await unknownLegacy.json()) as { error: { code: string } }).error.code,
  ).toBe('NOT_FOUND');

  const uppercased = await fetchById(legacyId.toUpperCase());
  expect(uppercased.status).toBe(400);
  expect(
    ((await uppercased.json()) as { error: { code: string } }).error.code,
  ).toBe('VALIDATION');
});

afterAll(async () => {
  const cleanup = new SQL(testDatabaseUrl);
  try {
    for (const id of createdIds) {
      await cleanup`DELETE FROM debates WHERE id = ${id}`;
    }
  } finally {
    await cleanup.close();
    await closeResources();
  }
});
