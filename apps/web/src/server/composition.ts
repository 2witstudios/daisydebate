import type { App } from './app';

/** What a feature's composition receives besides the app: only what the process owns. */
export type ProcessParts = {
  /** Process-owned vendor transport (Stripe); never the mail-capturing fetch. */
  readonly vendorFetch: typeof globalThis.fetch;
};

/**
 * One feature's route handlers, built from an app. Its route files bind to
 * it (`processRoute`), which builds it once per process app and reuses it;
 * a test calls `compose` on an app of its own. The name is the cache key,
 * because Next loads route handlers and server actions in separate bundle
 * layers, where the same module can be two function identities;
 * `composition.test.ts` fails on two compositions with one name.
 */
export type Composition<Routes> = {
  readonly name: string;
  readonly compose: (app: App, process: ProcessParts) => Routes;
};

export const defineComposition = <Routes>(
  name: string,
  compose: (app: App, process: ProcessParts) => Routes,
): Composition<Routes> => ({ name, compose });

/** Each composition built for one app, by name. */
export type Composed = Map<string, unknown>;

/** `composition` for this app: built on first use, then the same object. */
export const composedOn = <Routes>(
  composed: Composed,
  app: App,
  process: ProcessParts,
  composition: Composition<Routes>,
): Routes => {
  if (!composed.has(composition.name))
    composed.set(composition.name, composition.compose(app, process));
  return composed.get(composition.name) as Routes;
};
