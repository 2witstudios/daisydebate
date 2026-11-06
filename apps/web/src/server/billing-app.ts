import type { App } from './app';
import { createBillingStripe, type BillingFetch } from './billing-stripe';
import { composeNativeBilling } from '../features/billing/native-app';
import type { NativeBillingRuntime } from '../features/billing/native-contract';
import { memberHttpBoundary } from './member-boundary';
import { composeBillingRoutes } from '../features/billing/native-composition';

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

const native = createBillingNativeResolver();

/** Route modules receive the process resources through the authorized route binder. */
export const billingRoutes = (app: App, fetch: BillingFetch) =>
  composeBillingRoutes({
    boundary: memberHttpBoundary(app),
    runtime: () => native(app, fetch),
  });
