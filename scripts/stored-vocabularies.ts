import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Column, is, SQL, StringChunk } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';

/**
 * Every stored vocabulary: each column a CHECK constrains with `oneOf`,
 * read from the Drizzle tables themselves, so a new table is covered the
 * moment its CHECK exists (RECON-3.11). Both databases count: the
 * participant schema and the admin app's own.
 */
export type Vocabulary = ReadonlySet<string>;
export type StoredVocabularies = {
  /** SQL table name -> SQL column name -> its words. */
  readonly sql: ReadonlyMap<string, ReadonlyMap<string, Vocabulary>>;
  /** Drizzle table export -> column key -> its words. */
  readonly drizzle: ReadonlyMap<
    string,
    {
      readonly table: string;
      readonly columns: ReadonlyMap<string, Vocabulary>;
    }
  >;
};

const root = resolve(import.meta.dir, '..');
const schemaModules = [
  ...readdirSync(join(root, 'packages/db/src/schema'))
    .filter(
      (name) => name.endsWith('.ts') && !/\.test(-support)?\.ts$/.test(name),
    )
    .map((name) => join(root, 'packages/db/src/schema', name)),
  join(root, 'apps/admin/src/db/schema.ts'),
];

/** `column in ('a', 'b')` as `oneOf` writes it, anywhere inside a CHECK. */
function oneOfs(
  statement: SQL,
  found: (column: Column, words: readonly string[]) => void,
) {
  const chunks = statement.queryChunks;
  chunks.forEach((chunk, index) => {
    if (is(chunk, SQL)) return oneOfs(chunk, found);
    if (!is(chunk, Column)) return;
    const opener = chunks[index + 1];
    const list = chunks[index + 2];
    if (
      !is(opener, StringChunk) ||
      opener.value.join('').trim() !== 'in (' ||
      !is(list, SQL)
    )
      return;
    const text = list.queryChunks
      .map((part) => (is(part, StringChunk) ? part.value.join('') : ''))
      .join('');
    const words = [...text.matchAll(/'((?:''|[^'])*)'/g)].map(([, word = '']) =>
      word.replaceAll("''", "'"),
    );
    if (words.length > 0) found(chunk, words);
  });
}

export async function loadStoredVocabularies(): Promise<StoredVocabularies> {
  const sql = new Map<string, Map<string, Set<string>>>();
  const drizzle = new Map<
    string,
    { table: string; columns: Map<string, Set<string>> }
  >();
  for (const path of schemaModules) {
    const module: Record<string, unknown> = await import(path);
    for (const [exportName, table] of Object.entries(module)) {
      if (!is(table, PgTable)) continue;
      const config = getTableConfig(table);
      const keyOf = new Map(
        Object.entries(table)
          .filter((entry): entry is [string, Column] => is(entry[1], Column))
          .map(([key, column]) => [column.name, key]),
      );
      const columns = sql.get(config.name) ?? new Map<string, Set<string>>();
      sql.set(config.name, columns);
      const byKey = new Map<string, Set<string>>();
      for (const check of config.checks)
        oneOfs(check.value, (column, words) => {
          const set = columns.get(column.name) ?? new Set<string>();
          for (const word of words) set.add(word);
          columns.set(column.name, set);
          const key = keyOf.get(column.name);
          if (key) byKey.set(key, set);
        });
      if (byKey.size > 0)
        drizzle.set(exportName, { table: config.name, columns: byKey });
      if (columns.size === 0) sql.delete(config.name);
    }
  }
  return { sql, drizzle };
}
