import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  committedMigrationSql,
  installedFunction,
} from '../migrations.test-support';
import { isDebatingSeatSql } from '../seat-columns';

setupRitewayBun();

/** The ladder division rule as SQL text, its parameters written in. */
const inlined = (expression: Parameters<PgDialect['sqlToQuery']>[0]) => {
  const { sql: text, params } = new PgDialect().sqlToQuery(expression);
  return text.replace(/\$(\d+)/g, (_, index: string) => {
    const value = params[Number(index) - 1];
    return typeof value === 'number' ? String(value) : `'${String(value)}'`;
  });
};

test('the Room chat fact reads the Room’s own division (ADR 0162)', async () => {
  const installed = installedFunction(
    await committedMigrationSql(),
    'daisy_room_community_fact',
  )?.statement;
  assert({
    given:
      'the newest migration creating daisy_room_community_fact, the TypeScript division rule and the debating-seat list',
    should:
      'read the lobby classification and the debating seats exactly, so a Youth Room in chat is the Room the lobby calls Youth (decision 84)',
    actual: [
      typeof installed,
      installed?.includes('public.daisy_room_is_youth(youth_room.id)') &&
        installed.includes('public.daisy_room_is_youth(r.id),'),
      installed?.includes(
        `AND ${inlined(isDebatingSeatSql(sql.raw('seated.seat_kind')))}`,
      ),
    ],
    expected: ['string', true, true],
  });
});
