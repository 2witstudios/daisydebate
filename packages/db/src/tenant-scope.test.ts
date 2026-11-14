import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { scopeTransaction } from './tenant-scope';

setupRitewayBun();

const dialect = new PgDialect();

/** The statements a scope sends, with their parameters. */
const sent = async (scope: Parameters<typeof scopeTransaction>[1]) => {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  await scopeTransaction(
    {
      execute: async (query: ReturnType<typeof sql>) => {
        const { sql: text, params } = dialect.sqlToQuery(query);
        statements.push({ text: text.replace(/\s+/g, ' '), values: params });
      },
    },
    scope,
  );
  return statements;
};

describe('scopeTransaction', () => {
  test('sets all three scopes transaction-locally, clearing the ones not named', async () => {
    assert({
      given: 'a lobby scope alone, then no scope',
      should:
        'set the lobby and clear the organization and the subject, then clear all three, each local to the transaction',
      actual: [await sent({ lobbyId: 'lobby-1' }), await sent({})],
      expected: [
        [
          {
            text: "select set_config('daisy.organization_scope', $1, true), set_config('daisy.lobby_scope', $2, true), set_config('daisy.subject_scope', $3, true)",
            values: ['', 'lobby-1', ''],
          },
        ],
        [
          {
            text: "select set_config('daisy.organization_scope', $1, true), set_config('daisy.lobby_scope', $2, true), set_config('daisy.subject_scope', $3, true)",
            values: ['', '', ''],
          },
        ],
      ],
    });
  });

  test('no other module of the package names a scope setting', () => {
    const root = import.meta.dir;
    const naming = (readdirSync(root, { recursive: true }) as string[]).filter(
      (file) =>
        file.endsWith('.ts') &&
        !file.endsWith('.test.ts') &&
        /daisy\.(organization|lobby|subject)_scope/.test(
          readFileSync(join(root, file), 'utf8'),
        ),
    );
    assert({
      given: 'every source module of @daisy/db',
      should: 'find the scope settings named only by the scope opener',
      actual: naming,
      expected: ['tenant-scope.ts'],
    });
  });
});
