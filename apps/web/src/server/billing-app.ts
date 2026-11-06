import { createApp, type App, type AppDependencies } from './app';
import { createBillingStripe, type BillingFetch } from './billing-stripe';
import { composeNativeBilling } from '../features/billing/native-app';
import type { NativeBillingRuntime } from '../features/billing/native-runtime';

/** The process app and adopted test app use the same lazy production composition. */
export function createBillingApp(
  dependencies: AppDependencies,
  stripeFetch: BillingFetch,
): App {
  let native: NativeBillingRuntime | undefined;
  const app = createApp({
    ...dependencies,
    billingNative:
      dependencies.billingNative ??
      (() =>
        (native ??= composeNativeBilling(
          app,
          createBillingStripe(app.config.billing, stripeFetch),
        ))),
  });
  return app;
}
