import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createTestApp } from './fixtures';
import { requireTestServices } from '@daisy/config';

setupRitewayBun();
requireTestServices(process.env);

// The same proof routes as foundation.integration.ts, on this suite's own app
// built with the gate shut. Both suites run in one `bun test` process in any
// order; each answers from its own configuration, never the other's.
const { app, routes } = createTestApp({ FOUNDATION_PROOF_ENABLED: 'false' });
const origin = app.config.PUBLIC_APP_URL;

describe('ISSUE-7 foundation proof gate per app', () => {
  test('an app built with the proof disabled answers 404 however the other suite is configured', async () => {
    const created = await routes.foundationProof.POST(
      new Request(`${origin}/api/foundation/proof`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin },
        body: JSON.stringify({ resolution: 'Must not be stored' }),
      }),
    );
    const read = await routes.foundationProof.GET(
      new Request(`${origin}/api/foundation/proof?id=m4n6p8r2t4v6x8z1k3b5c7d9`),
    );
    const codeOf = async (response: Response) =>
      ((await response.json()) as { error: { code: string } }).error.code;
    assert({
      given:
        'a suite whose app was built with FOUNDATION_PROOF_ENABLED=false, sharing a process with one built with it true',
      should: 'refuse create and read with NOT_FOUND from its own config',
      actual: {
        flag: app.config.FOUNDATION_PROOF_ENABLED,
        created: [created.status, await codeOf(created)],
        read: [read.status, await codeOf(read)],
      },
      expected: {
        flag: false,
        created: [404, 'NOT_FOUND'],
        read: [404, 'NOT_FOUND'],
      },
    });
  });
});
