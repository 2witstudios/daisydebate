import type { BunSQLDatabase } from 'drizzle-orm/bun-sql';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { outbox } from './schema/outbox';

/**
 * Shape-only validation of the append input (RT-2.2 hazard note, plan
 * revision 4.8 item 6): full validation against `@daisy/protocol`'s
 * `outboxPayloadSchema` and its topic-family rule is wired in once RT-2.1b
 * merges (it is currently changing the payload `version` field and the
 * actor-id naming, and its family rule would wrongly reject `session.revoked`
 * / `access.revoked`, which never ride a subscribed topic family). Until
 * then, `payload` must at least be a plain object, matching the table's
 * `outbox_payload_is_object` CHECK: a non-object payload is a clean
 * application-level validation error here, not a raw Postgres CHECK
 * violation surfacing deep inside the caller's transaction.
 */
const outboxAppendInputSchema = z.strictObject({
  topic: z.string().min(1).max(200),
  kind: z.string().min(1).max(100),
  version: z.number().int().positive(),
  payload: z.record(z.string(), z.unknown()),
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
type Tx = Pick<BunSQLDatabase, 'execute'>;

/**
 * The protocol's own cursor shape (`@daisy/protocol`'s `cursorSchema`, plan
 * revision 4.8): `txid:seq`, each part 1-20 digits, no leading zero except
 * the value `0` itself. `xid8` and `bigserial` are both 64-bit; `xid8` is
 * unsigned, `bigserial` is signed.
 */
const positionShape = /^(0|[1-9][0-9]{0,19}):(0|[1-9][0-9]{0,19})$/;
const XID8_MAX = 2n ** 64n - 1n;
const BIGSERIAL_MAX = 2n ** 63n - 1n;

/**
 * The cursor is an ordering token, not a secret (plan: "Cursor
 * correctness"), but its shape is still validated on every use so a
 * client-supplied string is never trusted as SQL. It is the protocol's
 * plain `txid:seq` string, not a further-encoded wrapper: a DB cursor must
 * parse as a protocol cursor (plan revision 4.8).
 */
export function encodeOutboxCursor(position: OutboxPosition): string {
  return `${position.txid}:${position.seq.toString()}`;
}

const invalidCursor = (cause?: unknown) =>
  new Error(
    'Invalid outbox cursor',
    cause === undefined ? undefined : { cause },
  );

/** Both parts against their real 64-bit column types (xid8 unsigned, bigserial signed). */
function assertInPositionRange(txid: bigint, seq: bigint): void {
  if (txid < 0n || txid > XID8_MAX || seq < 0n || seq > BIGSERIAL_MAX)
    throw invalidCursor();
}

/**
 * Both parts are range-checked against their real 64-bit column types, so
 * an out-of-range cursor is a validation error here, not a Postgres cast
 * error at the query.
 */
export function decodeOutboxCursor(cursor: unknown): OutboxPosition {
  if (typeof cursor !== 'string' || cursor.length === 0 || cursor.length > 41)
    throw invalidCursor();
  const match = positionShape.exec(cursor);
  if (!match?.[1] || !match[2]) throw invalidCursor();
  const txid = BigInt(match[1]);
  const seq = BigInt(match[2]);
  assertInPositionRange(txid, seq);
  return { txid: match[1], seq };
}

/** The start of the log: every row is strictly after this position. */
export const OUTBOX_ORIGIN: OutboxPosition = { txid: '0', seq: 0n };

/**
 * Appends one outbox row inside the caller's transaction and issues
 * `pg_notify('outbox', position)` in the same transaction, so the
 * notification is only delivered to listeners once the transaction commits
 * (Postgres queues NOTIFY until commit) and never fires for a rollback.
 *
 * The insert goes through a raw statement, not `.insert(outbox).values()`:
 * drizzle-orm's `PgJsonb.mapToDriverValue` (0.45.2) unconditionally
 * `JSON.stringify`s the value before handing it to the driver, and the Bun
 * SQL client serializes a jsonb-bound *string* parameter again, storing a
 * double-encoded JSON string (`jsonb_typeof` reports `'string'`) instead of
 * the object every receiver's `safeParse` expects. Binding the plain JS
 * object directly, with no `JSON.stringify` and no explicit `::jsonb`
 * cast, is the one path that round-trips correctly through Bun's driver.
 */
export async function appendOutboxEvent(
  tx: Tx,
  input: OutboxAppendInput,
): Promise<OutboxPosition> {
  const parsed = outboxAppendInputSchema.parse(input);
  const result = await tx.execute(sql`
    insert into ${outbox} (topic, kind, version, payload)
    values (${parsed.topic}, ${parsed.kind}, ${parsed.version}, ${parsed.payload})
    returning seq, txid
  `);
  const [row] = result as unknown as { seq: unknown; txid: unknown }[];
  if (!row) throw new Error('Outbox insert returned no row');
  const position: OutboxPosition = {
    txid: String(row.txid),
    seq: BigInt(row.seq as string | number | bigint),
  };
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
