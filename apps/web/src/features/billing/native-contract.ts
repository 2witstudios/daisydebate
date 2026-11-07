import type { PurchaseDestination } from './purchase-flow';
import type { billingSettingsView } from './settings-view';

type Subject = { readonly userId: string; readonly actorId: string };
type Unavailable = { readonly kind: 'unavailable' };

/** Public operation results; no release reader, vendor resource or process authority enters this contract. */
export type NativeBillingRuntime = {
  readonly checkout: (
    subject: Subject,
  ) => Promise<PurchaseDestination | Unavailable>;
  readonly portal: (
    subject: Subject,
  ) => Promise<
    { readonly kind: 'redirect'; readonly url: string } | Unavailable
  >;
  readonly settings: (
    subject: Subject,
  ) => Promise<ReturnType<typeof billingSettingsView>>;
};
