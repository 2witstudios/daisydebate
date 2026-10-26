import type { ReactNode } from 'react';
// Next exports no public test router; tests mount its internal context.
import {
  AppRouterContext,
  type AppRouterInstance,
} from 'next/dist/shared/lib/app-router-context.shared-runtime';

const noop = () => {};
const router: AppRouterInstance = {
  bfcacheId: 'test',
  back: noop,
  forward: noop,
  refresh: noop,
  push: noop,
  replace: noop,
  prefetch: noop,
};

/** Mounts a router that goes nowhere, so a client page renders outside Next. */
export function WithAppRouter({ children }: { readonly children: ReactNode }) {
  return <AppRouterContext value={router}>{children}</AppRouterContext>;
}
