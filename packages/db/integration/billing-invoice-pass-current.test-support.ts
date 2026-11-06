import type { TransactionSQL } from 'bun';
const current = new URL(
  '../migrations/20261106223739_stripe_invoice_coverage_repair/migration.sql',
  import.meta.url,
);
const guard = 'CREATE OR REPLACE FUNCTION public.daisy_guard_stripe_cleanup()';

/** Current-role cases install the exact final guard bodies, without replaying index DDL or historical data repair. */
export async function installInvoicePassGuards(
  tx: Pick<TransactionSQL, 'unsafe'>,
  source = current,
) {
  const sql = await Bun.file(source).text(),
    start = sql.lastIndexOf(guard);
  if (start < 0) throw Error('Missing final current invoice guards');
  await tx.unsafe(sql.slice(start));
}

/** Explicit historical112 fixtures replay execution repair only; ordinary migration DDL is tested separately. */
export async function repairInvoicePassAuthority(
  tx: Pick<TransactionSQL, 'unsafe'>,
  source = current,
) {
  const sql = await Bun.file(source).text(),
    parts = sql.split('--> statement-breakpoint');
  if (
    !parts[0]?.startsWith(
      'CREATE INDEX "privacy_jobs_pending_vendor_due_idx"',
    ) ||
    !parts[1]?.includes(guard)
  )
    throw Error('Unexpected exact invoice repair migration layout');
  await tx.unsafe(parts.slice(1).join('--> statement-breakpoint'));
}
