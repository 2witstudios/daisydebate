import { z } from 'zod';
import { idSchema } from './primitives';

/**
 * Who pays (ADR 0148): an account buys Premium for itself; an organisation
 * buys a Club plan's seats. Exactly one, never both.
 */
export const billingOwnerSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('account'), userId: idSchema }),
  z.strictObject({
    kind: z.literal('organization'),
    organizationId: idSchema,
  }),
]);
export type BillingOwner = z.infer<typeof billingOwnerSchema>;

/** The most seats one Club plan carries (mirrors the database CHECKs). */
export const maxPurchaseQuantity = 200;

/** The two owner columns a billing row stores, exactly one set. */
export const billingOwnerColumns = (owner: BillingOwner) =>
  owner.kind === 'account'
    ? { userId: owner.userId, organizationId: null }
    : { userId: null, organizationId: owner.organizationId };

/** Reads the owner back from a row's two columns; null if not exactly one. */
export function billingOwnerOf(row: {
  readonly userId: string | null;
  readonly organizationId: string | null;
}): BillingOwner | null {
  if (row.userId !== null && row.organizationId === null)
    return { kind: 'account', userId: row.userId };
  if (row.userId === null && row.organizationId !== null)
    return { kind: 'organization', organizationId: row.organizationId };
  return null;
}
