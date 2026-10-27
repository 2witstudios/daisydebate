import { randomBytes } from 'node:crypto';
import { createClient } from '@clickhouse/client-web';
import { fixedClock, sequentialId } from '@daisy/clock';
import { requireTestClickHouse, requireTestServices } from '@daisy/config';
import { createLogger } from '@daisy/logger';
import { afterAll, expect } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createClickHouseSink } from '../src/clickhouse-sink';
import { createShipBuffer, type Batch } from '../src/ship';

setupRitewayBun();
requireTestServices(process.env);
const store = requireTestClickHouse(process.env);

const sink = createClickHouseSink({
  url: store.url,
  password: store.shipperPassword,
});
const reader = createClient({
  url: store.url,
  username: 'daisy_admin_reader',
  password: store.readerPassword,
});
afterAll(async () => {
  await sink.close();
  await reader.close();
});

// The shared store serves every slot: each test reads back only its own
// CSPRNG instance id.
const freshInstance = () => randomBytes(7).toString('hex');
const app = 'daisy-debate-staging';

/** A batch built the way the shipper builds one, from real logger output. */
function batchFor(instance: string, lines: number): Batch {
  const now = new Date().toISOString();
  let output = '';
  const logger = createLogger({
    service: 'web',
    appVersion: '7d94b6b',
    gitCommit: '7d94b6b153b556dabe0346bc2b727f989905e436',
    destination: { write: (text) => (output += text) },
  });
  for (let index = 0; index < lines; index += 1)
    logger.log(
      'invariant.violated',
      { invariantId: 'round.single-active', status: index },
      'Invariant violated',
    );
  const buffer = createShipBuffer({
    apps: new Set([app]),
    capacity: 100,
    maxBytes: 1_000_000,
    clock: fixedClock(now),
    ids: sequentialId(instance),
  });
  for (const line of output.trim().split('\n'))
    buffer.receive(
      `logs.${app}.ord.${instance}`,
      new TextEncoder().encode(
        JSON.stringify({
          fly: { app: { name: app, instance }, region: 'ord' },
          message: line,
        }),
      ),
    );
  return buffer.next(100)!;
}

const countFor = async (instance: string) => {
  const result = await reader.query({
    query:
      'SELECT count() AS n FROM daisy_logs.events WHERE instance = {instance:String}',
    query_params: { instance },
    format: 'JSONEachRow',
  });
  const [row] = await result.json<{ n: string | number }>();
  return Number(row?.n);
};

describe('the log store', () => {
  test('stores what the shipper admits, read back through the reader role', async () => {
    const instance = freshInstance();
    const batch = batchFor(instance, 2);
    await sink.insertRows(batch.rows, `${batch.id}-rows`);
    const result = await reader.query({
      query: `SELECT event, severity, invariant_id, status, user_id
        FROM daisy_logs.events WHERE instance = {instance:String} ORDER BY status`,
      query_params: { instance },
      format: 'JSONEachRow',
    });
    assert({
      given: 'two admitted invariant lines inserted by the shipper role',
      should: 'read back with their registry severity and allowlisted fields',
      actual: await result.json(),
      expected: [0, 1].map((status) => ({
        event: 'invariant.violated',
        severity: 'error',
        invariant_id: 'round.single-active',
        status,
        user_id: null,
      })),
    });
  });

  test('stores a retried batch once', async () => {
    const instance = freshInstance();
    const batch = batchFor(instance, 3);
    // The first insert is stored but its answer is lost; the shipper resends
    // the same rows under the same token.
    await sink.insertRows(batch.rows, `${batch.id}-rows`);
    await sink.insertRows(batch.rows, `${batch.id}-rows`);
    assert({
      given: 'the same batch inserted twice under one token',
      should: 'store its rows once',
      actual: await countFor(instance),
      expected: 3,
    });
  });

  test('stores a delayed retry once, after other batches', async () => {
    const instance = freshInstance();
    const late = batchFor(instance, 2);
    await sink.insertRows(late.rows, `${late.id}-rows`);
    for (let index = 0; index < 3; index += 1) {
      const other = batchFor(freshInstance(), 1);
      await sink.insertRows(other.rows, `${other.id}-rows`);
    }
    // The first answer was lost; the shipper retries only after others
    // were stored.
    await sink.insertRows(late.rows, `${late.id}-rows`);
    assert({
      given: 'a batch retried under its token after three other inserts',
      should: 'still store its rows once',
      actual: await countFor(instance),
      expected: 2,
    });
  });

  test('keeps identical events that arrive in different batches', async () => {
    const instance = freshInstance();
    const batch = batchFor(instance, 1);
    await sink.insertRows(batch.rows, `${batch.id}-a`);
    await sink.insertRows(batch.rows, `${batch.id}-b`);
    assert({
      given: 'identical rows under two different tokens',
      should: 'store both, never deduplicating by content',
      actual: await countFor(instance),
      expected: 2,
    });
  });

  test('gives each role only its own privilege', async () => {
    const shipperReader = createClient({
      url: store.url,
      username: 'daisy_shipper',
      password: store.shipperPassword,
    });
    const readerInsert = reader.insert({
      table: 'daisy_logs.shipper_drops',
      values: [
        { minute: '2026-10-27 13:01:00', app, reason: 'json', count: 1 },
      ],
      format: 'JSONEachRow',
    });
    const shipperSelect = shipperReader.query({
      query: 'SELECT count() FROM daisy_logs.events',
    });
    const readerSetting = reader.query({
      query: 'SELECT 1',
      clickhouse_settings: { max_execution_time: 600 },
    });
    await expect(readerInsert).rejects.toThrow('Not enough privileges');
    await expect(shipperSelect).rejects.toThrow('Not enough privileges');
    await expect(readerSetting).rejects.toThrow('readonly');
    await shipperReader.close();
  });

  test('the hourly sweep drops a day partition from its 29th day on', async () => {
    const instance = freshInstance();
    const batch = batchFor(instance, 1);
    await sink.insertRows(batch.rows, `${batch.id}-rows`);
    const day = String(batch.rows[0]?.received_at).slice(0, 10);
    const sweepSql = await Bun.file(
      new URL('../../../infra/clickhouse/sweep.sql', import.meta.url),
    ).text();
    const plusDays = (days: number) =>
      new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000)
        .toISOString()
        .slice(0, 10);
    const swept = async (today: string) => {
      const result = await reader.exec({
        query: sweepSql,
        query_params: { today },
      });
      const text = await new Response(result.stream).text();
      return text
        .trim()
        .split('\n')
        .some((line) => line === `events\t${day.replaceAll('-', '')}`);
    };
    assert({
      given: "a partition for today's receipts and the sweep run on later days",
      should: 'keep it through day + 28 and drop it from day + 29 on',
      actual: [
        await swept(plusDays(28)),
        await swept(plusDays(29)),
        await swept(plusDays(31)),
      ],
      expected: [false, true, true],
    });
  });

  test('gives every table a TTL inside the 30-day ceiling', async () => {
    const result = await reader.query({
      query: `SELECT name, create_table_query FROM system.tables
        WHERE database = 'daisy_logs' ORDER BY name`,
      format: 'JSONEachRow',
    });
    const tables = await result.json<{
      name: string;
      create_table_query: string;
    }>();
    assert({
      given: 'every table in daisy_logs',
      should: 'expire rows after at most 28 days, whole partitions at a time',
      actual: tables.map(({ name, create_table_query: ddl }) => ({
        name,
        days: Number(/TTL .*toIntervalDay\((\d+)\)/.exec(ddl)?.[1]),
        wholeParts: ddl.includes('ttl_only_drop_parts = 1'),
      })),
      expected: ['events', 'shipper_drops', 'shipper_heartbeats'].map(
        (name) => ({
          name,
          days: 28,
          wholeParts: true,
        }),
      ),
    });
  });

  test('has applied every migration in the folder', async () => {
    const files = [
      ...new Bun.Glob('*.sql').scanSync(
        new URL('../../../infra/clickhouse/migrations', import.meta.url)
          .pathname,
      ),
    ]
      .map((file) => file.replace(/\.sql$/, ''))
      .sort();
    const result = await reader.query({
      query:
        'SELECT version FROM daisy_meta.schema_migrations ORDER BY version',
      format: 'JSONEachRow',
    });
    assert({
      given: 'the versioned migrations and the store booted from them',
      should: 'record each file exactly once',
      actual: (await result.json<{ version: string }>()).map(
        (row) => row.version,
      ),
      expected: files,
    });
  });
});
