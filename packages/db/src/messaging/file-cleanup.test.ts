import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { createMessagingFileCleanup } from './file-cleanup';
setupRitewayBun();
const scope = {
  actorId: 'owner'.padEnd(24, 'x'),
  userId: 'user'.padEnd(24, 'x'),
  channelId: 'channel'.padEnd(24, 'x'),
};
const token = { fileId: 'file'.padEnd(24, 'x'), generation: 7 };
for (const denied of [true, false]) {
  test(`pending cleanup ${denied ? 'refusal rolls back before UPDATE' : 'uses exact fenced UPDATE'}`, async () => {
    const dialect = new PgDialect();
    const statements: ReturnType<PgDialect['sqlToQuery']>[] = [];
    const tx = {
      execute: async (query: SQL) => {
        const compiled = dialect.sqlToQuery(query);
        statements.push(compiled);
        if (compiled.sql.includes('daisy_authorization_accounts'))
          return [{ ...scope, member: true, erased: false, revision: 1 }];
        if (compiled.sql.includes('from messaging_channels'))
          return [
            {
              channelId: scope.channelId,
              kind: 'private_group',
              policyKey: 'social.private_group',
              policyRevision: 1,
              revision: 4,
            },
          ];
        if (compiled.sql.includes('from messaging_files'))
          return [
            {
              ...token,
              channelId: scope.channelId,
              ownerActorId: scope.actorId,
              lifecycle: 'reserved',
              revision: 2,
            },
          ];
        return [];
      },
    };
    let transactions = 0;
    const database = {
      transaction: async (work: (value: typeof tx) => Promise<void>) => {
        transactions += 1;
        return work(tx);
      },
    } as unknown as BunSQLDatabase;
    const cleanup = createMessagingFileCleanup({
      database,
      authorize: async (actualTx, input, frame) => {
        assert({
          given: 'the pending-file authorization callback',
          should:
            'receive the same fenced transaction and locked owner/channel facts',
          actual: [
            actualTx === tx,
            input,
            frame.fact.generation,
            frame.fact.channel.revision,
          ],
          expected: [true, scope, 7, 4],
        });
        if (denied) throw createAppError('AUTHORIZATION');
      },
    });
    if (denied)
      await assertRejects({
        given: 'canonical cleanup refusal',
        should: 'prevent the pending UPDATE',
        actual: () => cleanup(scope, token),
        code: 'AUTHORIZATION',
      });
    else await cleanup(scope, token);
    const updates = statements.filter((row) =>
      row.sql.trim().startsWith('update'),
    );
    assert({
      given: 'a completed cleanup frame',
      should: 'use one transaction and update only when authorized',
      actual: [transactions, updates.length],
      expected: [1, denied ? 0 : 1],
    });
    if (!denied)
      assert({
        given: 'the actual conditional pending-file UPDATE',
        should: 'bind file/channel/owner/generation and both pending states',
        actual: [
          updates[0]!.params,
          updates[0]!.sql.includes("lifecycle in ('reserved','quarantined')"),
        ],
        expected: [
          [token.fileId, scope.channelId, scope.actorId, token.generation],
          true,
        ],
      });
  });
}
