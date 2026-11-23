import { sql } from 'drizzle-orm';
import type { roomStatuses } from '@daisy/protocol/room-contract';
import type { RoundStatus } from '@daisy/protocol/round';

type LifecycleStatus = (typeof roomStatuses)[number] | RoundStatus;

/** Render a fixed vocabulary member so PostgreSQL can use partial indexes. */
export const lifecycleSql = (status: LifecycleStatus) =>
  sql`${status}`.inlineParams();

export const lifecycleSqlList = (statuses: readonly LifecycleStatus[]) =>
  sql`(${sql.join(statuses.map(lifecycleSql), sql`, `)})`;

/**
 * One word of a stored vocabulary in SQL text, inlined like `lifecycleSql`.
 * The compiler checks `word` against `list`, so SQL text never spells a
 * stored word itself (RECON-3.11); a word outside the list throws.
 */
export function listedWord<const List extends readonly string[]>(
  list: List,
  word: List[number],
) {
  if (!list.includes(word))
    throw new RangeError('A stored word outside its vocabulary list');
  return sql`${word}`.inlineParams();
}

/** Several words of one stored vocabulary, as `(…)` for `in`. */
export const listedWords = <const List extends readonly string[]>(
  list: List,
  words: readonly List[number][],
) =>
  sql`(${sql.join(
    words.map((word) => listedWord(list, word)),
    sql`, `,
  )})`;

/**
 * A stored word as a bound value, for a native Bun query, where a Drizzle
 * fragment cannot go. The compiler checks `word` against `list`.
 */
export function listedValue<const List extends readonly string[]>(
  list: List,
  word: List[number],
): List[number] {
  if (!list.includes(word))
    throw new RangeError('A stored word outside its vocabulary list');
  return word;
}

/**
 * A stored word as quoted SQL text, for a native statement that cannot bind
 * it: DDL, or the predicate an `on conflict … where` must match literally.
 */
export const listedLiteral = <const List extends readonly string[]>(
  list: List,
  word: List[number],
): string => `'${listedValue(list, word).replaceAll("'", "''")}'`;
