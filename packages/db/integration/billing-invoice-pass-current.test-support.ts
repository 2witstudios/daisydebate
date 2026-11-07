import type { TransactionSQL } from 'bun';
const current = new URL(
  '../migrations/20261107080513_fair_midnight/migration.sql',
  import.meta.url,
);
const historical = new URL(
  './fixtures/billing-private-113/20261106223739_stripe_invoice_coverage_repair.sql',
  import.meta.url,
);
const guard = 'CREATE OR REPLACE FUNCTION public.daisy_guard_stripe_cleanup()';

/** Current-role fixtures install only exact final function bodies, never canonical table DDL or historical conversion. */
export async function installInvoicePassGuards(
  tx: Pick<TransactionSQL, 'unsafe'>,
  source = current,
) {
  const sql = await Bun.file(source).text();
  for (const [name, delimiter] of [
    ['daisy_guard_stripe_cleanup', '$stripe_cleanup$;'],
    ['daisy_guard_billing_payment_observation', '$payment_observation$;'],
  ] as const) {
    const start = sql.lastIndexOf(
      `CREATE OR REPLACE FUNCTION public.${name}()`,
    );
    const end = sql.indexOf(delimiter, start);
    if (start < 0 || end < start)
      throw Error('Missing exact final invoice function');
    await tx.unsafe(sql.slice(start, end + delimiter.length));
  }
}

/** Exact private113 regression input only; not a canonical main99 or retained-slot transformation. */
export async function repairInvoicePassAuthority(
  tx: Pick<TransactionSQL, 'unsafe'>,
  source = historical,
) {
  const sql = await Bun.file(source).text(),
    parts = sql.split('--> statement-breakpoint');
  if (
    !parts[0]?.startsWith(
      'CREATE INDEX "privacy_jobs_pending_vendor_due_idx"',
    ) ||
    !parts[1]?.includes(guard)
  )
    throw Error('Unexpected exact historical invoice repair layout');
  await tx.unsafe(parts.slice(1).join('--> statement-breakpoint'));
}
