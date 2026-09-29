import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createId } from '@paralleldrive/cuid2';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createProductionServer } from '../src/server/server-wiring';
import { createTestApp, origin } from './fixtures';

requireTestServices(process.env);
setupRitewayBun();

/**
 * ISSUE-173: real auth requests through the server start.ts runs
 * (`createProductionServer` over `createApp`'s composed logger) must reach
 * both AUTH-7.7 counters, `/api/ops/metrics`'s `auth_http_requests_total`
 * and `/api/ops/alerts`'s `authRequests.total`, exactly once each. On
 * staging 107 real 429s moved neither.
 */
const opsToken = `ops-${createId()}${createId()}`;
const { app, routes, freshEmail } = createTestApp({
  OPS_PROBE_TOKEN: opsToken,
});

/** Stand-in for Next's handler: the same route handlers the app binds. */
const routeFor = (method: string, path: string) => {
  if (method === 'POST' && path.startsWith('/api/auth/'))
    return routes.auth.POST;
  if (method === 'GET' && path === '/api/ops/metrics')
    return routes.ops.metrics.GET;
  if (method === 'GET' && path === '/api/ops/alerts')
    return routes.ops.alerts.GET;
  return undefined;
};

async function toRequest(incoming: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of incoming) chunks.push(chunk as Buffer);
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers))
    if (typeof value === 'string') headers.set(name, value);
  return new Request(`${origin}${incoming.url}`, {
    method: incoming.method,
    headers,
    ...(incoming.method === 'POST' ? { body: Buffer.concat(chunks) } : {}),
  });
}

async function handle(incoming: IncomingMessage, outgoing: ServerResponse) {
  const route = routeFor(incoming.method ?? 'GET', incoming.url ?? '/');
  if (!route) {
    outgoing.writeHead(404);
    outgoing.end();
    return;
  }
  const response = await route(await toRequest(incoming));
  outgoing.writeHead(response.status, {
    'content-type': response.headers.get('content-type') ?? 'text/plain',
  });
  outgoing.end(await response.text());
}

async function serve() {
  const server = createProductionServer({
    app,
    handle,
    readRouteTable: () => null,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  const opsGet = (path: string) =>
    fetch(`${base}${path}`, {
      headers: { authorization: `Bearer ${opsToken}` },
    });
  return {
    magicLink: () =>
      fetch(`${base}/api/auth/sign-in/magic-link`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin },
        body: JSON.stringify({ email: freshEmail() }),
      }).then((response) => response.status),
    metrics: async () => {
      const text = await (await opsGet('/api/ops/metrics')).text();
      return Object.fromEntries(
        ['2xx', '3xx', '4xx', '5xx'].map((cls) => [
          cls,
          Number(
            text.match(
              new RegExp(
                `^auth_http_requests_total\\{status_class="${cls}"\\} (\\d+)$`,
                'm',
              ),
            )?.[1],
          ),
        ]),
      );
    },
    alertRequests: async () =>
      (
        (await (await opsGet('/api/ops/alerts')).json()) as {
          snapshot: {
            authRequests: {
              total: number;
              serverErrors: number;
              windowMinutes: number;
            };
          };
        }
      ).snapshot.authRequests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

describe('ISSUE-173 auth HTTP alert counters', () => {
  test('each completed auth request counts once in /api/ops/metrics and /api/ops/alerts', async () => {
    const edge = await serve();
    try {
      const statuses: number[] = [];
      for (let index = 0; index < 5; index += 1)
        statuses.push(await edge.magicLink());
      const metrics = await edge.metrics();
      const alertRequests = await edge.alertRequests();
      assert({
        given:
          'five real magic-link requests from one client through the production server, three admitted and two rate limited',
        should:
          'count 3 in 2xx and 2 in 4xx on /api/ops/metrics and 5 requests, 0 server errors on /api/ops/alerts',
        actual: { statuses, metrics, alertRequests },
        expected: {
          statuses: [200, 200, 200, 429, 429],
          metrics: { '2xx': 3, '3xx': 0, '4xx': 2, '5xx': 0 },
          alertRequests: { total: 5, serverErrors: 0, windowMinutes: 10 },
        },
      });
    } finally {
      await edge.close();
    }
  });
});
