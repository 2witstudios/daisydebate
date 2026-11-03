/**
 * Optional media recovery has its own 500 ms cadence and never waits behind
 * generation or control. A tick never waits for the one before it: `recover`
 * decides what each tick starts, so a slow Round holds only itself (ISSUE-972).
 */
export function startRoundMediaRecovery(input: {
  readonly recover: () => Promise<unknown>;
  readonly failed: () => void;
  readonly every: (
    ms: number,
    tick: () => void,
  ) => { readonly stop: () => void };
}) {
  let stopped = false;
  const running = new Set<Promise<void>>();
  const run = () => {
    if (stopped) return Promise.resolve();
    const tick: Promise<void> = Promise.resolve()
      .then(input.recover)
      .then(() => {})
      .catch(input.failed)
      .finally(() => {
        running.delete(tick);
      });
    running.add(tick);
    return tick;
  };
  const timer = input.every(500, () => {
    void run();
  });
  const started = run();
  return {
    started,
    async stop() {
      stopped = true;
      timer.stop();
      await Promise.all(running);
    },
  };
}
