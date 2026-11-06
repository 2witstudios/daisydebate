import { z } from 'zod';

const invoiceId = z
  .string()
  .max(255)
  .regex(/^in_[A-Za-z0-9_]+$/);

/** Observed identities whose actual routing is not yet retained; never money authority. */
export const invoiceIdentityDebtSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('none') }),
  z.strictObject({
    kind: z.literal('owed'),
    ids: z
      .array(invoiceId)
      .min(1)
      .refine((ids) => new Set(ids).size === ids.length),
    next: z.enum(['identity', 'observations']),
  }),
]);
export type InvoiceIdentityDebt = z.infer<typeof invoiceIdentityDebtSchema>;

/** Rotation preserves every known identity, including the exact selected remainder. */
export function retainInvoiceIdentities(
  debt: InvoiceIdentityDebt,
  ids: readonly string[],
): InvoiceIdentityDebt | null {
  const before = invoiceIdentityDebtSchema.safeParse(debt);
  const incoming = z.array(invoiceId).max(20).safeParse(ids);
  if (!before.success || !incoming.success) return null;
  const retained = [
    ...new Set([
      ...(before.data.kind === 'owed' ? before.data.ids : []),
      ...incoming.data,
    ]),
  ];
  return retained.length === 0
    ? { kind: 'none' }
    : {
        kind: 'owed',
        ids: retained,
        next: before.data.kind === 'owed' ? before.data.next : 'identity',
      };
}

export function nextInvoiceIdentity(
  debt: InvoiceIdentityDebt,
  observationsComplete: boolean,
): string | null {
  return debt.kind === 'owed' &&
    (debt.next === 'identity' || observationsComplete)
    ? debt.ids[0]!
    : null;
}

type DebtEvent =
  | { readonly kind: 'observation-step' }
  | {
      readonly kind: 'identity-failed' | 'identity-retained';
      readonly id: string;
    };

/** Called only after the owning exact-claim transaction commits its step. */
export function advanceInvoiceIdentityDebt(
  debt: InvoiceIdentityDebt,
  event: DebtEvent,
): InvoiceIdentityDebt | null {
  if (!invoiceIdentityDebtSchema.safeParse(debt).success) return null;
  if (debt.kind === 'none')
    return event.kind === 'observation-step' ? debt : null;
  if (event.kind === 'observation-step') return { ...debt, next: 'identity' };
  if (event.id !== debt.ids[0]) return null;
  const rest = debt.ids.slice(1);
  if (event.kind === 'identity-failed')
    return { kind: 'owed', ids: [...rest, event.id], next: 'observations' };
  return rest.length === 0
    ? { kind: 'none' }
    : { kind: 'owed', ids: rest, next: 'observations' };
}
