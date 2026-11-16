/** A manually advanced monotonic clock for PCM dependency proofs, never host timing. */
export const createCadenceTestClock = () => {
  let now = 0;
  const waiters = new Map<number, Set<() => void>>();
  const flush = async () => {
    // Enough promise turns for this bounded 80-frame fixture to reach its next wait.
    for (let turn = 0; turn < 128; turn += 1) await Promise.resolve();
  };
  return {
    nowMs: () => now,
    waitUntilMs: (due: number, signal: AbortSignal) =>
      new Promise<void>((resolve) => {
        if (signal.aborted || due <= now) return resolve();
        const bucket = waiters.get(due) ?? new Set<() => void>();
        const done = () => {
          bucket.delete(done);
          if (bucket.size === 0) waiters.delete(due);
          signal.removeEventListener('abort', done);
          resolve();
        };
        bucket.add(done);
        waiters.set(due, bucket);
        signal.addEventListener('abort', done, { once: true });
      }),
    advanceTo: async (until: number) => {
      if (until < now) throw new Error('Controlled time cannot move backward');
      await flush();
      while (now < until) {
        now += 1;
        for (const [due, bucket] of waiters)
          if (due <= now) for (const done of [...bucket]) done();
        await flush();
      }
    },
    pending: () =>
      [...waiters.values()].reduce((sum, bucket) => sum + bucket.size, 0),
  };
};
