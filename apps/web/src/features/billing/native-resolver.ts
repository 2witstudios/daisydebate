import type { App } from '../../server/app';
import { createBillingStripe, type BillingFetch } from './stripe-client';
import { composeNativeBilling } from './native-app';
import type { NativeBillingRuntime } from './native-contract';

/** Only Billing routes compose release authority; the proxy's shared App has a pure optional port. */
export function createBillingNativeResolver() {
  const held = new WeakMap<App, NativeBillingRuntime>();
  return (app: App, fetch: BillingFetch): NativeBillingRuntime => {
    const injected = app.billingNative();
    if (injected) return injected;
    const existing = held.get(app);
    if (existing) return existing;
    const runtime = composeNativeBilling(
      app,
      createBillingStripe(app.config.billing, fetch),
    );
    held.set(app, runtime);
    return runtime;
  };
}
