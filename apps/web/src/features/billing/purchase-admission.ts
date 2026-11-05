import type { Database } from '@daisy/db';
import type { BillingConfig } from '@daisy/config';
import {
  canManageBilling,
  canPurchasePremium,
} from '@daisy/auth/authorization';
import { createAppError } from '@daisy/errors';
import { releaseAdmission } from '../flags/admission';

/** The form supplies no offer, customer, redirect or release decision. */
export function createPurchaseAdmission(input: {
  readonly database: Pick<Database, 'billingPurchases'>;
  readonly config: BillingConfig;
  readonly returnOrigin: string;
}) {
  const store = input.database.billingPurchases({
    purchase: canPurchasePremium,
    manage: canManageBilling,
    release: releaseAdmission('premium-checkout'),
  });
  return async (
    subject: { readonly userId: string; readonly actorId: string } | null,
  ) => {
    if (!subject) throw createAppError('AUTHENTICATION');
    if (input.config.kind !== 'stripe') throw createAppError('NOT_FOUND');
    return store.admit(subject, {
      mode: input.config.mode,
      priceId: input.config.premiumPriceId,
      returnOrigin: input.returnOrigin,
    });
  };
}
