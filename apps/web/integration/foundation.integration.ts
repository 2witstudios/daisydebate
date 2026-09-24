import { afterAll } from 'bun:test';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createTestApp, withSql } from './fixtures';

requireTestServices(process.env);
setupRitewayBun();

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

const errorCode = async (response: Response) =>
  ((await response.json()) as { error: { code: string } }).error.code;

test('proof vertical: validated create, durable store, restored read', async () => {
  const created = await post({ resolution: '  Integration proof  ' });
  const snapshot = (await created.json()) as {
    version: number;
    id: string;
    resolution: string;
    phase: string;
    participants: unknown[];
  };
  createdIds.push(snapshot.id);
  const loaded = await fetchById(snapshot.id);
  const restored = (await loaded.json()) as {
    id: string;
    phase: string;
    format: string;
    rules: unknown;
  };
  const [format] = await withSql(
    (sql) => sql`select rules from formats where id = 'foundation'`,
  );
  assert({
    given: 'a proof debate created with a padded resolution, then read back',
    should:
      'answer 201 with a request id and a trimmed waiting snapshot, then restore it carrying the canonical foundation rules',
    actual: {
      created: {
        status: created.status,
        requestId: created.headers.get('x-request-id') !== null,
        version: snapshot.version,
        resolution: snapshot.resolution,
        phase: snapshot.phase,
        participants: snapshot.participants,
      },
      loaded: {
        status: loaded.status,
        id: restored.id,
        phase: restored.phase,
        format: restored.format,
        rules: restored.rules,
      },
    },
    expected: {
      created: {
        status: 201,
        requestId: true,
        version: 1,
        resolution: 'Integration proof',
        phase: 'waiting',
        participants: [],
      },
      loaded: {
        status: 200,
        id: snapshot.id,
        phase: 'waiting',
        format: 'foundation',
        rules: format?.rules,
      },
    },
  });
});

test('proof vertical rejects invalid, cross-origin, and unknown requests', async () => {
  // Its own record to read back, whichever test ran first.
  const stored = (await (
    await post({ resolution: 'Read-gate fixture' })
  ).json()) as { id: string };
  createdIds.push(stored.id);
  const read = (headers: Record<string, string>) =>
    GET(
      new Request(`${origin}/api/foundation/proof?id=${stored.id}`, {
        headers,
      }),
    ).then((response) => response.status);
  const tooLong = await post({ resolution: 'x'.repeat(501) });
  const crossOrigin = await post(
    { resolution: 'hostile' },
    { origin: 'https://evil.example' },
  );
  const missing = await fetchById('m4n6p8r2t4v6x8z1k3b5c7d9');
  const malformed = await fetchById('not-a-cuid2-identifier');
  const legacyUuid = await fetchById('0f0e6d1c-2b3a-4455-9a8b-7c6d5e4f3a21');
  assert({
    given:
      'an overlong resolution, a cross-origin write, cross-site and same-origin reads, and unknown, malformed and UUID ids',
    should:
      'refuse each with its own status and code, and admit only the same-origin read',
    actual: {
      tooLong: [tooLong.status, await errorCode(tooLong)],
      crossOriginWrite: crossOrigin.status,
      foreignOriginRead: await read({ origin: 'https://evil.example' }),
      crossSiteRead: await read({ 'sec-fetch-site': 'cross-site' }),
      sameOriginRead: await read({ 'sec-fetch-site': 'same-origin' }),
      missing: [missing.status, await errorCode(missing)],
      malformed: malformed.status,
      legacyUuid: [legacyUuid.status, await errorCode(legacyUuid)],
    },
    expected: {
      tooLong: [400, 'VALIDATION'],
      crossOriginWrite: 403,
      foreignOriginRead: 403,
      crossSiteRead: 403,
      sameOriginRead: 200,
      missing: [404, 'NOT_FOUND'],
      malformed: 400,
      legacyUuid: [400, 'VALIDATION'],
    },
  });
});

afterAll(() =>
  withSql(async (sql) => {
    for (const id of createdIds)
      await sql`DELETE FROM debates WHERE id = ${id}`;
  }),
);
