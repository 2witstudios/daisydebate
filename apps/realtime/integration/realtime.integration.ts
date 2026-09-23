import { expect, test } from 'bun:test';
import { createDatabase } from '@daisy/db';
import { createRedis } from '@daisy/redis';
import { createLogger } from '@daisy/logger';
import { ENVELOPE_VERSION, PROTOCOL_VERSION } from '@daisy/protocol';
import { createRealtimeServer, SOCKET_PATH } from '../src/server';

function requiredEnv(name: 'TEST_DATABASE_URL' | 'TEST_REDIS_URL'): string {
  const value = process.env[name];
  if (!value)
    throw new Error(
      `apps/realtime integration tests require TEST_DATABASE_URL and TEST_REDIS_URL (missing ${name})`,
    );
  return value;
}
const databaseUrl = requiredEnv('TEST_DATABASE_URL');
const redisUrl = requiredEnv('TEST_REDIS_URL');

/** A real Bun.serve server against real PostgreSQL and Redis, bound to an ephemeral port. */
function bootServer() {
  const logger = createLogger({
    service: 'realtime-integration-test',
    level: 'silent',
  });
  const database = createDatabase({ url: databaseUrl });
  const redis = createRedis({
    url: redisUrl,
    namespace: `test-${crypto.randomUUID().slice(0, 8)}`,
  });
  const resources = { draining: false, database, redis, logger };
  const { fetch, websocket } = createRealtimeServer({ resources });
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch,
    websocket,
  });
  return {
    server,
    origin: `http://127.0.0.1:${server.port}`,
    async close() {
      server.stop(true);
      await Promise.allSettled([
        database.close(),
        Promise.resolve(redis.close()),
      ]);
    },
  };
}

const awaitClose = (ws: WebSocket) =>
  new Promise<{ code: number; reason: string }>((resolve) => {
    ws.addEventListener('close', (event) =>
      resolve({ code: event.code, reason: event.reason }),
    );
  });

test('answers liveness and readiness against real PostgreSQL and Redis', async () => {
  const { origin, close } = bootServer();
  try {
    const live = await fetch(`${origin}/health/live`);
    expect(live.status).toBe(200);
    expect(await live.json()).toEqual({ status: 'alive' });

    const ready = await fetch(`${origin}/health/ready`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({
      status: 'ready',
      checks: { database: true, listen: true, redis: true },
    });
  } finally {
    await close();
  }
});

test('refuses a non-WebSocket request to the socket path with 400, never falling through', async () => {
  const { origin, close } = bootServer();
  try {
    const response = await fetch(`${origin}${SOCKET_PATH}`);
    expect(response.status).toBe(400);
  } finally {
    await close();
  }
});

test('a real WebSocket client sending hello first is closed 4001 auth_failed', async () => {
  const { origin, close } = bootServer();
  const ws = new WebSocket(origin.replace('http', 'ws') + SOCKET_PATH);
  try {
    const closed = awaitClose(ws);
    ws.addEventListener('open', () => {
      ws.send(
        JSON.stringify({
          v: ENVELOPE_VERSION,
          type: 'hello',
          protocolVersion: PROTOCOL_VERSION,
          ticket: 'a'.repeat(43),
        }),
      );
    });

    expect(await closed).toEqual({ code: 4001, reason: 'auth_failed' });
  } finally {
    await close();
  }
});

test('a real WebSocket client sending an unparseable first frame is closed 4003 protocol_unsupported', async () => {
  const { origin, close } = bootServer();
  const ws = new WebSocket(origin.replace('http', 'ws') + SOCKET_PATH);
  try {
    const closed = awaitClose(ws);
    ws.addEventListener('open', () => ws.send('not json'));

    expect(await closed).toEqual({
      code: 4003,
      reason: 'protocol_unsupported',
    });
  } finally {
    await close();
  }
});

test('a real WebSocket client sending a well-formed message before hello is closed 4001, proving hello is not silently accepted', async () => {
  const { origin, close } = bootServer();
  const ws = new WebSocket(origin.replace('http', 'ws') + SOCKET_PATH);
  try {
    const closed = awaitClose(ws);
    ws.addEventListener('open', () => {
      ws.send(
        JSON.stringify({
          v: ENVELOPE_VERSION,
          type: 'ping',
          id: 'a'.repeat(24),
        }),
      );
    });

    expect(await closed).toEqual({ code: 4001, reason: 'auth_failed' });
  } finally {
    await close();
  }
});
