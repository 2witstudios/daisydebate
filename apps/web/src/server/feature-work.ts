import type { Waits } from '@daisy/clock';
import type { App } from './app';
import type { WorkWakes } from './work-wakes';

/** What shutdown needs of each piece of background work. */
export type Stoppable = { readonly stop: () => Promise<unknown> };

/**
 * What a feature's background work receives: the app, and what the process
 * owns and every feature shares (injected time, the work wakes, this
 * instance's service identity, the vendor transport).
 */
export type ProcessWork = {
  readonly app: App;
  readonly waits: Waits;
  /** Each loop's wake for the work it looks for (ADR 0154). */
  readonly wakes: WorkWakes;
  /** This instance's service identity, held by the availability lease. */
  readonly instanceId: string;
  /** Process-owned vendor transport (Stripe). */
  readonly vendorFetch: typeof globalThis.fetch;
};

/** A feature's running background work, by loop name, stopped as one. */
export type FeatureWork = Stoppable & { readonly running: readonly string[] };

/** One feature's start: its work, or null when nothing of it is configured. */
export type StartWork = (
  process: ProcessWork,
) => FeatureWork | null | Promise<FeatureWork | null>;

/** The loops a feature started, by name; null when none is configured. */
export const featureWork = (
  loops: Readonly<Record<string, Stoppable | null | undefined>>,
): FeatureWork | null => {
  const started = Object.entries(loops).flatMap(([name, loop]) =>
    loop ? [{ name, loop }] : [],
  );
  if (started.length === 0) return null;
  return {
    running: started.map(({ name }) => name),
    stop: () => Promise.all(started.map(({ loop }) => loop.stop())),
  };
};
