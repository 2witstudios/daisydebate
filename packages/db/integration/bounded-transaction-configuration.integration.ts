import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { sql } from 'drizzle-orm';
import { withBoundedRound } from './bounded-transaction.test-support';
setupRitewayBun();
requireTestServices(process.env);

const forbidden = [
  "UPDATE pg_catalog.pg_settings SET setting='0' WHERE name='statement_timeout'",
  'UPDATE "pg_catalog"."pg_settings" SET setting=\'0\' WHERE name=\'idle_in_transaction_session_timeout\'',
  "WITH changed AS (UPDATE pg_settings SET setting='0' WHERE name='lock_timeout' RETURNING name) SELECT * FROM changed",
  "EXPLAIN ANALYZE UPDATE pg_catalog.pg_settings SET setting='0' WHERE name='statement_timeout'",
  "SELECT 1 -- carriage return ends comment\r, pg_catalog.set_config('statement_timeout','0',true)",
  "SELECT 1 -- CRLF ends comment\r\n, pg_catalog.set_config('idle_in_transaction_session_timeout','0',true)",
  "SELECT pg_catalog.\"set_config\"('statement_timeout','0',true)",
  "SELECT pg_catalog.set_config /* documented whitespace */ ('idle_in_transaction_session_timeout','0',true)",
  'SELECT "pg_catalog"."set_config" /* nested /* inner */ outer */ (\'lock_timeout\',\'0\',true)',
  "SELECT pg_catalog.set_config -- newline\n ('statement_timeout','0',true)",
  "SELECT pg_catalog.U&\"set\\005fconfig\"('statement_timeout','0',true)",
  "SELECT pg_catalog.U&\"set!005fconfig\" UESCAPE '!'('statement_timeout','0',true)",
  "SELECT 'harmless set_config', pg_catalog.\"set_config\"('statement_timeout','0',true)",
  "SELECT $$harmless set_config$$, pg_catalog.\"set_config\"('statement_timeout','0',true)",
];
for (const command of forbidden) {
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

for (const [expression, value] of [
  ["'set_config'", 'set_config'],
  ["'can''t call set_config'", "can't call set_config"],
  ['$$set_config /* is data */$$', 'set_config /* is data */'],
  [
    '$body$set_config $$ nested delimiter text$body$',
    'set_config $$ nested delimiter text',
  ],
  ["E'set_config\\ntext'", 'set_config\ntext'],
  ["E'can\\'t set_config'", "can't set_config"],
  ["U&'set\\005fconfig'", 'set_config'],
  ["E'prefix'\n'set_config'", 'prefixset_config'],
]) {
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
