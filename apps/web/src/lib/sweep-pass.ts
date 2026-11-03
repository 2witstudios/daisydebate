/**
 * One sweep's walk over rows that each get independent work. Every row in the set
 * is reached, however many there are, and they run side by side, so a slow one
 * delays no other. Past `budget` the pass returns and that work runs on: the next
 * pass skips a row still running, and `settled` waits for all of it at shutdown.
 */
export const createSweepPass = (budget?: () => Promise<void>) => {
  const running = new Map<string, Promise<void>>();
  const overPage = async <T>(
    page: readonly T[],
    keyOf: (row: T) => string,
    work: (row: T) => Promise<unknown>,
    failed: () => void,
  ) => {
    const started = page.flatMap((row) => {
      const key = keyOf(row);
      if (running.has(key)) return [];
      const run = Promise.resolve()
        .then(() => work(row))
        .then(
          () => undefined,
          () => failed(),
        )
        .finally(() => running.delete(key));
      running.set(key, run);
      return [run];
    });
    const all = Promise.all(started);
    await (budget ? Promise.race([all, budget()]) : all);
  };
  return {
    overPages: async <T>(
      size: number,
      read: (after: string | null) => Promise<readonly T[]>,
      keyOf: (row: T) => string,
      work: (row: T) => Promise<unknown>,
      failed: () => void,
    ) => {
      let after: string | null = null;
      for (;;) {
        const page: readonly T[] = await read(after);
        await overPage(page, keyOf, work, failed);
        if (page.length < size) return;
        after = keyOf(page.at(-1)!);
      }
    },
    settled: async () => {
      await Promise.all(running.values());
    },
  };
};
