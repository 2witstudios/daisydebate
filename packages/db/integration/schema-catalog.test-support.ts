import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { readSchemaCatalog, type SchemaCatalog } from '../src/schema-catalog';

/** The catalog of the database at `url`, read on a connection of its own. */
export async function catalogAt(url: string): Promise<SchemaCatalog> {
  const client = new SQL(url, { max: 1 });
  try {
    return await readSchemaCatalog(drizzle({ client }));
  } finally {
    await client.close();
  }
}

/**
 * Every row of every table in `public`, as sorted text. The old history
 * stamps clock and transaction-id columns when each folder runs, so those
 * read as present or absent, never as a value.
 */
export async function rowsAt(
  url: string,
): Promise<ReadonlyMap<string, string>> {
  const client = new SQL(url, { max: 1 });
  try {
    const columns = (await client`
      select c.relname as "table", a.attname as "column",
        format_type(a.atttypid, null) in ('timestamp with time zone',
          'timestamp without time zone', 'date', 'xid8') as stamped
      from pg_attribute a join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
        and a.attnum > 0 and not a.attisdropped
      order by 1, a.attnum`) as {
      table: string;
      column: string;
      stamped: boolean;
    }[];
    const tables = new Map<string, typeof columns>();
    for (const column of columns)
      tables.set(column.table, [...(tables.get(column.table) ?? []), column]);
    const rows = new Map<string, string>();
    for (const [table, list] of tables) {
      const select = list
        .map(({ column, stamped }) =>
          stamped ? `("${column}" is not null)::text` : `"${column}"::text`,
        )
        .join(', ');
      const read = (await client.unsafe(
        `select array[${select}] as row from public."${table}"`,
      )) as { row: (string | null)[] }[];
      rows.set(
        table,
        JSON.stringify(read.map(({ row }) => JSON.stringify(row)).sort()),
      );
    }
    return rows;
  } finally {
    await client.close();
  }
}
