import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { isDebatingSeatSql } from '../seat-columns';

setupRitewayBun();

const migrations = join(import.meta.dir, '../../migrations');
const declaration =
  /CREATE (?:OR REPLACE )?FUNCTION public\.daisy_room_community_fact\([\s\S]*?\$room_community_fact\$;/i;

/** The ladder division rule as SQL text, its parameters written in. */
const inlined = (expression: Parameters<PgDialect['sqlToQuery']>[0]) => {
  const { sql: text, params } = new PgDialect().sqlToQuery(expression);
  return text.replace(/\$(\d+)/g, (_, index: string) => {
    const value = params[Number(index) - 1];
    return typeof value === 'number' ? String(value) : `'${String(value)}'`;
  });
};

test('the Room chat fact reads the Room’s own division (ADR 0156)', () => {
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
  assert({
    given:
      'the newest migration creating daisy_room_community_fact, the TypeScript division rule and the debating-seat list',
    should:
      'read rooms.division and the debating seats exactly, so a Youth Room in chat is the Room the lobby calls Youth (decision 84)',
    actual: [
      typeof installed,
      installed?.includes("youth_room.division='youth'") &&
        installed.includes("r.division='youth',"),
      installed?.includes(
        `AND ${inlined(isDebatingSeatSql(sql.raw('seated.seat_kind')))}`,
      ),
    ],
    expected: ['string', true, true],
  });
});
