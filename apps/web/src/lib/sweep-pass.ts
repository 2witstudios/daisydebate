/**
 * How long one page of a pass may hold the pass: a wait on injected time,
 * such as `(signal) => waits.sleep(ms, signal)`. Its signal aborts once the
 * page's work ends first, so no wait outlives the page.
 */
export type PassBudget = (signal: AbortSignal) => Promise<void>;

/**
 * One sweep's walk over rows that each get independent work. Every row in the set
 * is reached, however many there are, and they run side by side, so a slow one
 * delays no other. Past `budget` the pass returns and that work runs on: the next
 * pass skips a row still running, and `settled` waits for all of it at shutdown.
 */
export const createSweepPass = (budget?: PassBudget) => {
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
    if (!budget) {
      await all;
      return;
    }
    const ended = new AbortController();
    try {
      await Promise.race([all, budget(ended.signal)]);
    } finally {
      ended.abort();
    }
  };
  return {
    overPages: async <T>(
      size: number,
      read: (after: string | null) => Promise<readonly T[]>,
      keyOf: (row: T) => string,
      work: (row: T) => Promise<unknown>,
      failed: () => void,
    ): Promise<number> => {
      let after: string | null = null;
      let rows = 0;
      for (;;) {
        const page: readonly T[] = await read(after);
        rows += page.length;
        await overPage(page, keyOf, work, failed);
        const last = page.at(-1);
        if (last === undefined || page.length < size) return rows;
        after = keyOf(last);
      }
    },
    settled: async () => {
      await Promise.all(running.values());
    },
  };
};
