import type { BunSQLDatabase } from 'drizzle-orm/bun-sql';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { outbox } from './schema/outbox';

/**
 * Shape-only validation of the append input (RT-2.2 hazard note): the
 * portable event contract lives in `@daisy/protocol` and is wired in once
 * RT-2.1 merges. `payload` is opaque jsonb here.
 */
const outboxAppendInputSchema = z.strictObject({
  topic: z.string().min(1).max(200),
  kind: z.string().min(1).max(100),
  version: z.number().int().positive(),
  payload: z.unknown(),
});
export type OutboxAppendInput = z.infer<typeof outboxAppendInputSchema>;

export type OutboxPosition = { readonly txid: string; readonly seq: bigint };

export type OutboxRow = OutboxPosition & {
  readonly topic: string;
  readonly kind: string;
  readonly version: number;
  readonly payload: unknown;
  readonly createdAt: string;
};

/** A transaction handle: what `database.transaction(async (tx) => ...)` hands the caller. */
type Tx = Pick<BunSQLDatabase, 'insert' | 'execute'>;

const positionShape = /^([0-9]{1,20})\.([0-9]{1,20})$/;

/**
 * The cursor is an ordering token, not a secret (plan: "Cursor
 * correctness"). It is still opaque to clients and validated on every use,
 * so it is base64url-encoded rather than handed over as raw SQL literals.
 */
export function encodeOutboxCursor(position: OutboxPosition): string {
  return Buffer.from(`${position.txid}.${position.seq.toString()}`).toString(
    'base64url',
  );
}

export function decodeOutboxCursor(cursor: unknown): OutboxPosition {
  if (typeof cursor !== 'string' || cursor.length === 0 || cursor.length > 64)
    throw new Error('Invalid outbox cursor');
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch (error) {
    throw new Error('Invalid outbox cursor', { cause: error });
  }
  const match = positionShape.exec(decoded);
  if (!match?.[1] || !match[2]) throw new Error('Invalid outbox cursor');
  return { txid: match[1], seq: BigInt(match[2]) };
}

/** The start of the log: every row is strictly after this position. */
export const OUTBOX_ORIGIN: OutboxPosition = { txid: '0', seq: 0n };

/**
 * Appends one outbox row inside the caller's transaction and issues
 * `pg_notify('outbox', position)` in the same transaction, so the
 * notification is only delivered to listeners once the transaction commits
 * (Postgres queues NOTIFY until commit) and never fires for a rollback.
 */
export async function appendOutboxEvent(
  tx: Tx,
  input: OutboxAppendInput,
): Promise<OutboxPosition> {
  const parsed = outboxAppendInputSchema.parse(input);
  const [row] = await tx
    .insert(outbox)
    .values({
      topic: parsed.topic,
      kind: parsed.kind,
      version: parsed.version,
      payload: parsed.payload,
    })
    .returning({ seq: outbox.seq, txid: outbox.txid });
  if (!row) throw new Error('Outbox insert returned no row');
  const position: OutboxPosition = { txid: row.txid, seq: row.seq };
  await tx.execute(
    sql`select pg_notify('outbox', ${encodeOutboxCursor(position)})`,
  );
  return position;
}

const MAX_DRAIN_LIMIT = 500;

/**
 * Commit-ordered drain (plan: "Cursor correctness"). Reads only rows whose
 * inserting transaction has finished for every observer
 * (`txid < pg_snapshot_xmin(pg_current_snapshot())`), so a row from a
 * transaction that committed after a higher `seq` became visible is never
 * skipped: it is still ordered by `(txid, seq)` ahead of positions already
 * drained past it.
 */
export async function drainOutbox(
  db: Pick<BunSQLDatabase, 'execute'>,
  cursor: OutboxPosition,
  limit = MAX_DRAIN_LIMIT,
): Promise<readonly OutboxRow[]> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_DRAIN_LIMIT)
    throw new Error('Invalid outbox drain limit');
  const result = await db.execute(sql`
    select seq, txid, topic, kind, version, payload, created_at as "createdAt"
    from outbox
    where (txid, seq) > (${cursor.txid}::xid8, ${cursor.seq.toString()}::bigint)
      and txid < pg_snapshot_xmin(pg_current_snapshot())
    order by txid, seq
    limit ${limit}
  `);
  return (result as unknown as Record<string, unknown>[]).map((row) => ({
    seq: BigInt(row.seq as string | number | bigint),
    txid: String(row.txid),
    topic: String(row.topic),
    kind: String(row.kind),
    version: Number(row.version),
    payload: row.payload,
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : String(row.createdAt),
  }));
}

const RETENTION_BATCH_LIMIT = 500;

/**
 * Retention prune (plan: "Maintenance prunes the outbox after a retention
 * window"). Deletes at most `limit` rows older than `before`, skipping
 * locked rows so a concurrent drain is never blocked. Each call is one
 * autocommitted statement over `db.execute`, never wrapped in
 * `database.transaction(...)`: a long-running transaction anywhere in the
 * cluster holds back `pg_snapshot_xmin`, which `drainOutbox` depends on to
 * decide a row is final, so the maintenance sweep must never hold one open
 * across many rows or many batches.
 */
export async function purgeExpiredOutboxEvents(
  db: Pick<BunSQLDatabase, 'execute'>,
  input: { before: string; limit: number },
): Promise<number> {
  if (
    !Number.isSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > RETENTION_BATCH_LIMIT ||
    Number.isNaN(Date.parse(input.before))
  )
    throw new Error('Invalid outbox purge bounds');
  const deleted = await db.execute(sql`
    delete from ${outbox} where ${outbox.seq} in (
      select ${outbox.seq} from ${outbox}
      where ${outbox.createdAt} < ${input.before}::timestamptz
      order by ${outbox.createdAt}
      limit ${input.limit}
      for update skip locked
    ) returning ${outbox.seq}
  `);
  return (deleted as unknown as unknown[]).length;
}
