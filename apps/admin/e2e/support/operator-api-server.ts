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

Bun.serve({
  hostname: 'localhost',
  port: e2eOperatorApi.port,
  fetch: (request) =>
    request.method === 'GET' && new URL(request.url).pathname === '/ready'
      ? new Response('ready')
      : stub.handle(request),
});
