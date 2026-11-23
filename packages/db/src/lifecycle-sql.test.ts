import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  listedLiteral,
  listedValue,
  listedWord,
  listedWords,
} from './lifecycle-sql';

setupRitewayBun();

const visibilities = ['public', 'unlisted', 'private'] as const;
const rendered = (statement: ReturnType<typeof sql>) =>
  new PgDialect().sqlToQuery(statement);

test('a stored word reaches SQL inlined, never spelled in the text', () => {
  assert({
    given: 'one word and a list of words of a vocabulary',
    should: 'inline them as literals PostgreSQL can match to a partial index',
    actual: [
      rendered(sql`visibility = ${listedWord(visibilities, 'public')}`),
      rendered(
        sql`visibility in ${listedWords(visibilities, ['public', 'unlisted'])}`,
      ),
    ],
    expected: [
      { sql: "visibility = 'public'", params: [] },
      { sql: "visibility in ('public', 'unlisted')", params: [] },
    ],
  });
});

test('a word outside its list is refused', () => {
  const attempt = () => {
    try {
      // @ts-expect-error the compiler refuses a word the list does not hold
      return listedWord(visibilities, 'secret');
    } catch (error) {
      return error instanceof RangeError ? 'refused' : 'other';
    }
  };
  assert({
    given: 'a word the vocabulary does not hold',
    should: 'refuse it at compile time and at run time',
    actual: attempt(),
    expected: 'refused',
  });
});

test('a native query binds or quotes a stored word, checked the same way', () => {
  assert({
    given: 'a word for a bound parameter and one for DDL text',
    should: 'give the word itself and its quoted SQL literal',
    actual: [
      listedValue(visibilities, 'unlisted'),
      listedLiteral(visibilities, 'private'),
    ],
    expected: ['unlisted', "'private'"],
  });
});
