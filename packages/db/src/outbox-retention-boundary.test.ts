import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readOutboxRetentionBoundary } from './outbox-retention-boundary';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';

setupRitewayBun();

test('retention boundary refuses missing or malformed durable ordering facts', async () => {
  for (const [rows, expected] of [
    [[], null],
    [[{ txid: '12', seq: '0' }], { txid: '12', seq: 0n }],
    [[{ txid: '12', seq: '-1' }], null],
    [[{ txid: '18446744073709551616', seq: '0' }], null],
    [
      [
        { txid: '12', seq: '0' },
        { txid: '13', seq: '1' },
      ],
      null,
    ],
  ] as const) {
    const database = {
      execute: async () => rows,
    } as unknown as Pick<BunSQLDatabase, 'execute'>;
    assert({
      given: 'the persisted singleton or invalid adapter output',
      should: 'return only one validated boundary, otherwise fail closed',
      actual: await readOutboxRetentionBoundary(database),
      expected,
    });
  }
});
