import { systemClock } from '@daisy/clock';
import { createOperatorApiStub } from './operator-api-stub';
import { e2eOperatorApi, e2ePendingAccount } from './operator-api-fixture';

/**
 * The browser journey's participant-app stand-in: the verifying stub on
 * loopback, seeded with one pending account. It never touches a database;
 * the participant app's own suites prove the durable side.
 */
const stub = createOperatorApiStub({
  audience: e2eOperatorApi.audience,
  keyId: e2eOperatorApi.keyId,
  key: new Uint8Array(Buffer.from(e2eOperatorApi.key, 'base64url')),
  nowMs: () => Date.parse(systemClock.now()),
  accounts: [{ ...e2ePendingAccount }],
});

// Explicit delivery-display fixtures; durable worker outcomes are proved in DB suites.
for (const [letter, email, invitation] of [
  ['f', 'failed-invitation@example.test', 'failed'],
  ['u', 'unknown-invitation@example.test', 'unknown'],
] as const)
  stub.preapprovals.set(letter.repeat(24), {
    id: letter.repeat(24),
    email,
    revision: 1,
    createdAt: '2026-11-06T00:00:00.000Z',
    status: 'unused',
    invitation,
  });

Bun.serve({
  hostname: 'localhost',
  port: e2eOperatorApi.port,
  fetch: (request) =>
    request.method === 'GET' && new URL(request.url).pathname === '/ready'
      ? new Response('ready')
      : stub.handle(request),
});
