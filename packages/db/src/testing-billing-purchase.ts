import { requireTestServices } from '@daisy/config';
import type { createBillingPurchases } from './billing-purchase-store';

type Purchases = ReturnType<typeof createBillingPurchases>;

/** Controlled completed Session through real admission and mapping; no paid evidence or vendor execution. */
export async function completeControlledBillingPurchase(input: {
  readonly purchases: Purchases;
  readonly subject: Parameters<Purchases['admit']>[0];
  readonly offer: Parameters<Purchases['admit']>[1];
  readonly session: {
    readonly kind: 'complete';
    readonly id: string;
    readonly customerId: string;
    readonly subscriptionId: string;
  };
}) {
  requireTestServices(process.env);
  const { purchases, subject, offer, session } = input;
  const admitted = await purchases.admit(subject, offer);
  await purchases.recover(subject, admitted.purchase.id);
  const result = await purchases.record(subject, admitted.purchase.id, {
    kind: 'observe',
    session,
  });
  if (result !== 'changed')
    throw Error(
      'Controlled completed Session did not establish its purchase mapping',
    );
  return admitted.purchase.id;
}
