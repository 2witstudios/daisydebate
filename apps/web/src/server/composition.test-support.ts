import type { App } from './app';
import { composedOn, type Composition } from './composition';

/**
 * A test's way to reach one feature's handlers: each composition built on
 * the test's own app, once, as the process binder builds it.
 */
export const composer = (
  app: App,
  vendorFetch: typeof globalThis.fetch = globalThis.fetch,
) => {
  const composed = new Map<string, unknown>();
  return <Routes>(composition: Composition<Routes>): Routes =>
    composedOn(composed, app, { vendorFetch }, composition);
};

export type Composer = ReturnType<typeof composer>;
