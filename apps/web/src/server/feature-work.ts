/** What shutdown needs of each piece of background work. */
export type Stoppable = { readonly stop: () => Promise<unknown> };

/** A feature's running background work, by loop name, stopped as one. */
export type FeatureWork = Stoppable & { readonly running: readonly string[] };

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
