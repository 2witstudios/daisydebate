import { afterAll, expect, test } from 'bun:test';
import { SQL } from 'bun';
import { createTestApp, testDatabaseUrl } from './auth-mounted-helpers';
import { requireTestServices } from '@daisy/config';

requireTestServices(process.env);

// This suite's own app, with the development-only proof gate open; the
// production configuration still refuses this combination. Nothing global
// is set, so other suites in this process keep their own configuration
// (foundation-disabled.integration.ts proves the gate stays shut there).
const { app, routes } = createTestApp({ FOUNDATION_PROOF_ENABLED: 'true' });
const { POST, GET } = routes.foundationProof;

const origin = app.config.PUBLIC_APP_URL;
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
  const restored = (await loaded.json()) as {
    id: string;
    phase: string;
    format: string;
    rules: unknown;
  };
  expect(restored.id).toBe(snapshot.id);
  expect(restored.phase).toBe('waiting');
  // The snapshot carries the canonical foundation rules from the formats row.
  const reference = new SQL(testDatabaseUrl as string);
  try {
    const [format] =
      await reference`select rules from formats where id = 'foundation'`;
    expect(restored.format).toBe('foundation');
    expect(restored.rules).toEqual(format?.rules);
  } finally {
    await reference.close();
  }
});

test('proof vertical rejects invalid, cross-origin, and unknown requests', async () => {
  // Its own record to read back, whichever test ran first.
  const stored = (await (
    await post({ resolution: 'Read-gate fixture' })
  ).json()) as { id: string };
  createdIds.push(stored.id);
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

  for (const headers of [
    { origin: 'https://evil.example' },
    { 'sec-fetch-site': 'cross-site' },
  ]) {
    const crossOriginRead = await GET(
      new Request(`${origin}/api/foundation/proof?id=${stored.id}`, {
        headers,
      }),
    );
    expect(crossOriginRead.status).toBe(403);
  }
  const sameOriginRead = await GET(
    new Request(`${origin}/api/foundation/proof?id=${stored.id}`, {
      headers: { 'sec-fetch-site': 'same-origin' },
    }),
  );
  expect(sameOriginRead.status).toBe(200);

  const missing = await fetchById('m4n6p8r2t4v6x8z1k3b5c7d9');
  expect(missing.status).toBe(404);
  expect(
    ((await missing.json()) as { error: { code: string } }).error.code,
  ).toBe('NOT_FOUND');

  const malformed = await fetchById('not-a-cuid2-identifier');
  expect(malformed.status).toBe(400);

  const legacyUuid = await fetchById('0f0e6d1c-2b3a-4455-9a8b-7c6d5e4f3a21');
  expect(legacyUuid.status).toBe(400);
  expect(
    ((await legacyUuid.json()) as { error: { code: string } }).error.code,
  ).toBe('VALIDATION');
});

afterAll(async () => {
  const cleanup = new SQL(testDatabaseUrl as string);
  try {
    for (const id of createdIds) {
      await cleanup`DELETE FROM debates WHERE id = ${id}`;
    }
  } finally {
    await cleanup.close();
  }
});
