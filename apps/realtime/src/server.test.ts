import type { Server } from 'bun';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { Logger } from '@daisy/logger';
import {
  createRealtimeServer,
  SOCKET_PATH,
  type RealtimeServerResources,
} from './server';
import type { SocketData } from './socket';

setupRitewayBun();

const noopLogger: Logger = { log: () => {}, child: () => noopLogger };

const resources = (
  overrides: Partial<RealtimeServerResources> = {},
): RealtimeServerResources => ({
  draining: false,
  database: { health: async () => true, checkListen: async () => true },
  redis: { health: async () => true },
  logger: noopLogger,
  ...overrides,
});

const fakeServer = (upgraded: boolean): Server<SocketData> =>
  ({ upgrade: () => upgraded }) as unknown as Server<SocketData>;

describe('createRealtimeServer fetch', () => {
  test('answers /health/live without touching resources', async () => {
    const server = createRealtimeServer({ resources: resources() });
    const response = await server.fetch(
      new Request('http://localhost/health/live'),
      fakeServer(false),
    );

    assert({
      given: 'a liveness probe',
      should: 'answer 200 alive',
      actual: { status: response?.status, body: await response?.json() },
      expected: { status: 200, body: { status: 'alive' } },
    });
  });

  test('answers /health/ready 200 when every dependency is healthy', async () => {
    const server = createRealtimeServer({ resources: resources() });
    const response = await server.fetch(
      new Request('http://localhost/health/ready'),
      fakeServer(false),
    );

    assert({
      given: 'Postgres, LISTEN and Redis all healthy',
      should: 'answer 200 ready',
      actual: response?.status,
      expected: 200,
    });
  });

  test('answers /health/ready 503 when draining', async () => {
    const server = createRealtimeServer({
      resources: resources({ draining: true }),
    });
    const response = await server.fetch(
      new Request('http://localhost/health/ready'),
      fakeServer(false),
    );

    assert({
      given: 'a draining process',
      should: 'answer 503 unavailable',
      actual: { status: response?.status, body: await response?.json() },
      expected: {
        status: 503,
        body: {
          status: 'unavailable',
          checks: { database: true, listen: true, redis: true },
        },
      },
    });
  });

  test('upgrades a WebSocket request on the socket path', async () => {
    const server = createRealtimeServer({ resources: resources() });
    const response = await server.fetch(
      new Request(`http://localhost${SOCKET_PATH}`),
      fakeServer(true),
    );

    assert({
      given: 'a request Bun successfully upgrades',
      should:
        'return undefined, handing the response to the WebSocket protocol',
      actual: response,
      expected: undefined,
    });
  });

  test('answers 400 on the socket path when the upgrade is refused', async () => {
    const server = createRealtimeServer({ resources: resources() });
    const response = await server.fetch(
      new Request(`http://localhost${SOCKET_PATH}`),
      fakeServer(false),
    );

    assert({
      given: 'a non-WebSocket request to the socket path',
      should: 'answer 400, never falling through to any other route',
      actual: response?.status,
      expected: 400,
    });
  });

  test('answers 404 for any other path', async () => {
    const server = createRealtimeServer({ resources: resources() });
    const response = await server.fetch(
      new Request('http://localhost/anything-else'),
      fakeServer(false),
    );

    assert({
      given: 'a path with no route',
      should: 'answer 404',
      actual: response?.status,
      expected: 404,
    });
  });
});
