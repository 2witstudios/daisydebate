import Stripe from 'stripe';
import type { BillingConfig } from '@daisy/config';

export type BillingFetch = NonNullable<
  Parameters<typeof Stripe.createFetchHttpClient>[0]
>;

/** One pinned, bounded vendor resource; account and purchase authority stay in operations. */
export function createBillingStripe(
  config: BillingConfig,
  fetch: BillingFetch,
) {
  return config.kind === 'disabled'
    ? null
    : new Stripe(config.secretKey, {
        apiVersion: '2026-10-28.endive',
        timeout: 5_000,
        maxNetworkRetries: 0,
        telemetry: false,
        httpClient: Stripe.createFetchHttpClient(fetch),
      });
}
