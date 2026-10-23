import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { sql } from 'drizzle-orm';
import { withBoundedRound } from './bounded-transaction.test-support';
import {
  forbiddenConfiguration,
  literalConfiguration,
} from '../src/transaction-statement.test-support';
setupRitewayBun();
requireTestServices(process.env);

for (const command of forbiddenConfiguration) {
  test(`configuration ownership survives PostgreSQL lexical form ${command}`, async () =>
    withBoundedRound(async (f, run, roundId) => {
      await assertRejects({
        given:
          'configuration functions or writable settings views through SQL lexical variants',
        should:
          'refuse and roll back earlier writes even if the callback catches it',
        code: 'INVARIANT',
        actual: () =>
          run(async (tx) => {
            await tx.execute(
              sql`update rounds set resolution='before forbidden config' where id=${roundId}`,
            );
            try {
              await tx.execute(sql.raw(command));
            } catch {
              /* Fault injection deliberately catches the ownership refusal. */
            }
            return 'accepted';
          }),
      });
      const [row] =
        await f.sql`select resolution from rounds where id=${roundId}`;
      assert({
        given: 'a refused configuration escape',
        should: 'preserve the original row',
        actual: row.resolution === 'before forbidden config',
        expected: false,
      });
    }));
}

for (const [expression, value] of literalConfiguration) {
  test(`literal data does not become a configuration token: ${expression}`, async () =>
    withBoundedRound(async (_f, run) => {
      const result = await run(async (tx) => {
        const [literal] = await tx.execute(
          sql.raw(`SELECT ${expression} as value`),
        );
        const [settings] = await tx.execute(
          sql`select current_setting('statement_timeout') as statement,current_setting('lock_timeout') as lock,current_setting('idle_in_transaction_session_timeout') as idle,current_setting('standard_conforming_strings') as strings`,
        );
        return { literal, settings };
      });
      assert({
        given: 'configuration-looking words inside PostgreSQL string literals',
        should: 'read them as data and retain every server backstop',
        actual: result,
        expected: {
          literal: { value },
          settings: { statement: '2s', lock: '2s', idle: '2s', strings: 'on' },
        },
      });
    }));
}
