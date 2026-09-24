import { SQL } from 'bun';
import { systemClock, systemId } from '@daisy/clock';
import { createRealtimeApp } from '../src/app';
import { serveRealtime } from '../src/serve';
import type { OutboxRowsSink } from '../src/outbox-drain';

function requiredEnv(name: 'TEST_DATABASE_URL' | 'TEST_REDIS_URL'): string {
  const value = process.env[name];
  if (!value)
    throw new Error(
      `apps/realtime integration tests require TEST_DATABASE_URL and TEST_REDIS_URL (missing ${name})`,
    );
  return value;
}
export const databaseUrl = requiredEnv('TEST_DATABASE_URL');
const redisUrl = requiredEnv('TEST_REDIS_URL');

/**
 * A real Bun.serve server on this test's own realtime app (its own env and
 * Redis namespace) against real PostgreSQL and Redis, bound to an ephemeral
 * port. Startup order (ADR 0032 §2) runs for real here: `startOutboxDrain`
 * is awaited before `Bun.serve`, exactly as `start.ts` sequences it, so
 * sockets are only ever accepted once LISTEN and the high-water mark read
 * have both completed.
 */
export async function bootServer(
  overrides: {
    readonly sink?: OutboxRowsSink;
    readonly pollIntervalMs?: number;
    readonly onQuery?: () => void;
    /** Observes a reconnect independent of database content or other listeners' traffic (RT-2.3b-f1 criterion 2). */
    readonly onListenWake?: () => void;
    /** Tags the drain connection so a test can find and kill it by name. */
    readonly applicationNameTag?: string;
  } = {},
) {
  const taggedUrl = overrides.applicationNameTag
    ? `${databaseUrl}${databaseUrl.includes('?') ? '&' : '?'}application_name=${overrides.applicationNameTag}`
    : databaseUrl;
  const resources = createRealtimeApp({
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: taggedUrl,
      REDIS_URL: redisUrl,
      REDIS_NAMESPACE: `test-${systemId.next().slice(0, 10)}`,
      LOG_LEVEL: 'silent',
    },
    clock: systemClock,
    ids: systemId,
  });
  const { server, drain } = await serveRealtime({
    resources,
    port: 0,
    hostname: '127.0.0.1',
    sink: overrides.sink ?? (() => {}),
    ...(overrides.pollIntervalMs === undefined
      ? {}
      : { pollIntervalMs: overrides.pollIntervalMs }),
    ...(overrides.onQuery === undefined ? {} : { onQuery: overrides.onQuery }),
    ...(overrides.onListenWake === undefined
      ? {}
      : { onListenWake: overrides.onListenWake }),
  });
  return {
    server,
    origin: `http://127.0.0.1:${server.port}`,
    drain,
    async close() {
      server.stop(true);
      await drain.stop();
      await resources.close();
    },
  };
}

export const awaitClose = (ws: WebSocket) =>
  new Promise<{ code: number; reason: string }>((resolve) => {
    ws.addEventListener('close', (event) =>
      resolve({ code: event.code, reason: event.reason }),
    );
  });

export const waitFor = async (
  check: () => boolean,
  timeoutMs = 5000,
): Promise<void> => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs)
      throw new Error('Timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

/** Bypasses application validation to exercise the drain loop directly, as packages/db's own outbox.integration.ts does. */
export async function insertOutboxRow(
  client: SQL,
  input: { topic: string; kind: string; version: number; payload: unknown },
): Promise<{ txid: string; seq: bigint }> {
  const [row] = await client.unsafe(
    'insert into outbox (topic, kind, version, payload) values ($1, $2, $3, $4::jsonb) returning txid, seq',
    [input.topic, input.kind, input.version, input.payload],
  );
  const record = row as {
    txid: string | number | bigint;
    seq: string | number | bigint;
  };
  return { txid: String(record.txid), seq: BigInt(record.seq) };
}

export async function notifyOutbox(
  client: SQL,
  position: { txid: string; seq: bigint },
): Promise<void> {
  await client.unsafe('select pg_notify($1, $2)', [
    'outbox',
    `${position.txid}:${position.seq.toString()}`,
  ]);
}

/**
 * Inserts `count` rows with distinct payloads and NOTIFYs each, all inside
 * one transaction: PostgreSQL folds identical NOTIFY payloads sent in the
 * same transaction into one delivery, so distinct payloads (a different
 * `entityVersion` per row) are what proves a real burst, not an artifact of
 * NOTIFY de-duplication.
 */
export async function insertAndNotifyBurst(
  client: SQL,
  topic: string,
  count: number,
): Promise<void> {
  await client.begin(async (tx) => {
    for (let index = 0; index < count; index += 1) {
      const [row] = await tx.unsafe(
        'insert into outbox (topic, kind, version, payload) values ($1, $2, $3, $4::jsonb) returning txid, seq',
        [
          topic,
          'debate.phase-changed',
          1,
          {
            entityVersion: index + 1,
            kind: 'debate.phase-changed',
            ids: [topic],
          },
        ],
      );
      const record = row as {
        txid: string | number | bigint;
        seq: string | number | bigint;
      };
      await tx.notify(
        'outbox',
        `${String(record.txid)}:${BigInt(record.seq).toString()}`,
      );
    }
  });
}
