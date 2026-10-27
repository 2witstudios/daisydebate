import { and, asc, countDistinct, desc, inArray, lt, sql } from 'drizzle-orm';
import type { AdminExecutor, AdminTransaction } from '../db/client';
import { auditEvents, chainCheckpoints } from '../db/schema';
import {
  chainNext,
  genesisAnchor,
  verifyAuditChain,
  type AuditDetail,
  type AuditEvent,
  type AuditKind,
  type AuditRow,
  type ChainAnchor,
  type ChainVerdict,
} from './chain';

const toRow = (row: typeof auditEvents.$inferSelect): AuditRow => ({
  ...row,
  kind: row.kind as AuditKind,
  detail: row.detail as AuditDetail | null,
  at: row.at.toISOString(),
});

/** The newest checkpoint: where the retained chain starts. */
async function chainStart(db: AdminExecutor): Promise<ChainAnchor> {
  const [checkpoint] = await db
    .select({ seq: chainCheckpoints.seq, hash: chainCheckpoints.hash })
    .from(chainCheckpoints)
    .orderBy(desc(chainCheckpoints.seq))
    .limit(1);
  return checkpoint ?? genesisAnchor;
}

/**
 * Appends one event inside the caller's transaction. The transaction-scoped
 * advisory lock serializes every append, so each row reads the true head;
 * a failed insert rolls back with the work it records.
 */
export async function appendAudit(
  tx: AdminTransaction,
  event: AuditEvent,
): Promise<AuditRow> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext('daisy-admin-audit-chain'))`,
  );
  const [head] = await tx
    .select({ seq: auditEvents.seq, hash: auditEvents.hash })
    .from(auditEvents)
    .orderBy(desc(auditEvents.seq))
    .limit(1);
  const row = chainNext(head ?? (await chainStart(tx)), event);
  await tx.insert(auditEvents).values({ ...row, at: new Date(row.at) });
  return row;
}

/** Newest first, keyset-paged by seq. */
export async function readAuditPage(
  db: AdminExecutor,
  input: { readonly before?: number; readonly limit: number },
): Promise<readonly AuditRow[]> {
  const rows = await db
    .select()
    .from(auditEvents)
    .where(
      input.before === undefined
        ? undefined
        : lt(auditEvents.seq, input.before),
    )
    .orderBy(desc(auditEvents.seq))
    .limit(input.limit);
  return rows.map(toRow);
}

/** Walks the whole retained chain from its checkpoint. */
export async function verifyStoredChain(
  db: AdminExecutor,
  known: readonly ChainAnchor[] = [],
): Promise<ChainVerdict> {
  const start = await chainStart(db);
  const rows = await db
    .select()
    .from(auditEvents)
    .orderBy(asc(auditEvents.seq));
  return verifyAuditChain(rows.map(toRow), start, known);
}

/**
 * Commands whose anchor the participant app acknowledged: a result came
 * back, directly or by reconciliation, so its receipt holds the chain head.
 */
export async function acknowledgedAnchors(db: AdminExecutor): Promise<number> {
  const [row] = await db
    .select({ anchors: countDistinct(auditEvents.commandId) })
    .from(auditEvents)
    .where(
      and(
        inArray(auditEvents.kind, ['command.outcome', 'command.reconciled']),
        inArray(auditEvents.outcome, ['changed', 'unchanged']),
      ),
    );
  return row?.anchors ?? 0;
}
