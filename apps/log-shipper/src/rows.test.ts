import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { loggableFields } from '@daisy/logger';
import { columnOf, toEventRow } from './rows';

setupRitewayBun();

// The events table as the migrations leave it: the baseline's columns plus
// every later ADD COLUMN, in file order.
const migrationsDir = new URL(
  '../../../infra/clickhouse/migrations/',
  import.meta.url,
);
const migrations = await Promise.all(
  [...new Bun.Glob('*.sql').scanSync(migrationsDir.pathname)]
    .sort()
    .map((file) => Bun.file(new URL(file, migrationsDir)).text()),
);
const eventColumns = migrations
  .flatMap((sql) => [
    ...(
      /CREATE TABLE IF NOT EXISTS daisy_logs\.events\s*\(([\s\S]*?)\n\)/.exec(
        sql,
      )?.[1] ?? ''
    )
      .split('\n')
      .map((line) => /^\s*([a-z_]+)\s/.exec(line)?.[1]),
    ...[
      ...sql.matchAll(
        /ALTER TABLE daisy_logs\.events ADD COLUMN IF NOT EXISTS ([a-z_]+)/g,
      ),
    ].map((match) => match[1]),
  ])
  .filter((column): column is string => column !== undefined);

const record = {
  app: 'daisy-debate-staging',
  region: 'ord',
  instance: '811006b93572d8',
  message: '',
};
const entry = {
  at: '2026-10-27T13:01:53.439Z',
  event: 'auth.rate_limit.denied',
  severity: 'warn',
  service: 'web',
  appVersion: '7d94b6b',
  gitCommit: 'abc123',
  fields: { clientIdHash: 'a'.repeat(64), status: 429 },
} as const;

describe('event rows', () => {
  test('the events table has exactly one column per loggable field', () => {
    assert({
      given: 'the ClickHouse migrations and @daisy/logger loggableFields',
      should: 'hold the placement and base columns plus one column per field',
      actual: [...eventColumns].sort(),
      expected: [
        'received_at',
        'ts',
        'app',
        'region',
        'instance',
        'service',
        'app_version',
        'git_commit',
        'event',
        'severity',
        ...Object.keys(loggableFields).map(columnOf),
      ].sort(),
    });
  });

  test('maps an admitted line onto every column', () => {
    const row = toEventRow(record, entry, '2026-10-27T13:01:54.000Z');
    assert({
      given: 'an admitted line with two fields',
      should: 'fill its columns, null the rest and write both UTC times',
      actual: {
        columns: Object.keys(row).sort(),
        receivedAt: row.received_at,
        ts: row.ts,
        clientIdHash: row.client_id_hash,
        status: row.status,
        userId: row.user_id,
      },
      expected: {
        columns: [...eventColumns].sort(),
        receivedAt: '2026-10-27 13:01:54.000',
        ts: '2026-10-27 13:01:53.439',
        clientIdHash: 'a'.repeat(64),
        status: 429,
        userId: null,
      },
    });
  });
});
