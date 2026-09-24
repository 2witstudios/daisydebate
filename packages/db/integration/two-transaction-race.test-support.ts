import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';

export type RaceRow = {
  readonly txid: string | bigint;
  readonly seq: string | bigint;
};

/**
 * Opens transaction A, inserts, then opens and commits transaction B while
 * A is still open — the classic out-of-commit-order race both the drain's
 * and the high-water mark's "never skip a row" proofs exercise. Neither
 * row is queryable by a third reader until A also commits, which the
 * caller does when ready. A third, uninvolved connection (`connC` /
 * `drizzleC`) is also opened, for the caller's own reads.
 */
export async function openOutOfOrderTransactions(
  url: string,
  topic: string,
): Promise<{
  readonly connA: SQL;
  readonly connB: SQL;
  readonly connC: SQL;
  readonly drizzleC: BunSQLDatabase;
  readonly rowA: RaceRow;
  readonly rowB: RaceRow;
}> {
  const connA = new SQL(url, { max: 1 });
  const connB = new SQL(url, { max: 1 });
  const connC = new SQL(url, { max: 1 });
  await connA.unsafe('BEGIN');
  const [rowA] = await connA.unsafe(
    "insert into outbox (topic, kind, version, payload) values ($1, 'test.a', 1, '{}'::jsonb) returning seq, txid",
    [topic],
  );
  await connB.unsafe('BEGIN');
  const [rowB] = await connB.unsafe(
    "insert into outbox (topic, kind, version, payload) values ($1, 'test.b', 1, '{}'::jsonb) returning seq, txid",
    [topic],
  );
  await connB.unsafe('COMMIT');
  return {
    connA,
    connB,
    connC,
    drizzleC: drizzle({ client: connC }),
    rowA: rowA as RaceRow,
    rowB: rowB as RaceRow,
  };
}
