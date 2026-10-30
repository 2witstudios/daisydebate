import { assert, setupRitewayBun, test } from 'riteway/bun';
import { noopErrorReporter } from '@daisy/observability';
import { silentLogger } from '../../server/test-loggers.test-support';
import { member, origin } from '../../server/member-handler.test-support';
import { createContactHandlers } from './handlers';

setupRitewayBun();

const post = (path: string, body: unknown) =>
  new Request(`${origin}${path}`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

test('Contacts’ routes answer only the published block result', async () => {
  const seen: unknown[] = [];
  const handlers = createContactHandlers({
    boundary: {
      logger: silentLogger,
      reporter: noopErrorReporter,
      origin: () => origin,
      identify: async () => member as never,
    },
    block: async (input) => {
      seen.push(['block', input]);
      return { blocked: true, revision: 2 };
    },
    blockByUsername: async (input) => {
      seen.push(['username', input]);
      return { blocked: false, revision: 3 };
    },
  });
  const byId = await handlers.block(
    post('/api/contacts/block', { version: 1 }),
  );
  const byName = await handlers.blockByUsername(
    post('/api/contacts/username', { version: 1 }),
  );
  const crossSite = await handlers.block(
    new Request(`${origin}/api/contacts/block`, {
      method: 'POST',
      headers: {
        origin: 'https://evil.example',
        'content-type': 'application/json',
      },
      body: '{}',
    }),
  );
  assert({
    given: 'a block by actor ID, a block by username, and a cross-site post',
    should:
      'run each operation once with the member’s body and refuse the cross-site post before any work',
    actual: [
      byId.status,
      await byId.json(),
      byName.status,
      await byName.json(),
      crossSite.status,
      seen,
    ],
    expected: [
      200,
      { version: 1, blocked: true, revision: 2 },
      200,
      { version: 1, blocked: false, revision: 3 },
      403,
      [
        ['block', { version: 1 }],
        ['username', { version: 1 }],
      ],
    ],
  });
});
