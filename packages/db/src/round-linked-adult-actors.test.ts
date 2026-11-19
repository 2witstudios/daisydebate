import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { isDebatingSeatSql } from './seat-columns';
import { youthRoundSql } from './youth-round-sql';

setupRitewayBun();

const migrations = join(import.meta.dir, '../migrations');
const declaration =
  /CREATE (?:OR REPLACE )?FUNCTION public\.daisy_round_linked_adult_actors\([\s\S]*?\$round_linked_adult_actors\$;/i;

/** A predicate as SQL text, its parameters written in. */
const inlined = (expression: Parameters<PgDialect['sqlToQuery']>[0]) => {
  const { sql: text, params } = new PgDialect().sqlToQuery(expression);
  return text.replace(
    /\$(\d+)/g,
    (_, index: string) => `'${String(params[Number(index) - 1])}'`,
  );
};

/** The same SQL however it is spaced, cased, commented or schema-qualified. */
const normal = (text: string) =>
  text
    .replace(/--[^\n]*/g, '')
    .toLowerCase()
    .replaceAll('public.', '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([=(),])\s*/g, '$1')
    .trim();

/**
 * ADR 0158: `daisy_round_linked_adult_actors` writes out `youthRoundSql`'s
 * Youth test and `isDebatingSeatSql`'s seats, so a Youth Round's Recording,
 * its publication and its people read decide alike. A change to either
 * TypeScript predicate fails here until a migration redefines the function.
 */
test('the linked-adult Round read uses the Youth Round and debating-seat predicates verbatim', () => {
  const installed = readdirSync(migrations)
    .sort()
    .map((tag) => {
      try {
        return readFileSync(join(migrations, tag, 'migration.sql'), 'utf8');
      } catch {
        return '';
      }
    })
    .flatMap((text) => declaration.exec(text)?.[0] ?? [])
    .at(-1);
  const body = normal(installed ?? '');
  assert({
    given:
      'the newest migration creating daisy_round_linked_adult_actors, youthRoundSql and isDebatingSeatSql',
    should: 'contain both predicates as the TypeScript renders them',
    actual: {
      found: installed !== undefined,
      youthRound: body.includes(
        normal(inlined(youthRoundSql(sql.raw('requested_round_id')))),
      ),
      debatingSeat: body.includes(
        normal(inlined(isDebatingSeatSql(sql.raw('p.seat_kind')))),
      ),
    },
    expected: { found: true, youthRound: true, debatingSeat: true },
  });
});
