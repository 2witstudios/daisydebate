/** Optional media recovery has its own500ms cadence and never waits behind generation/control. */
export function startRoundMediaRecovery(input: {
  readonly recover: () => Promise<unknown>;
  readonly failed: () => void;
  readonly every: (
    ms: number,
    tick: () => void,
  ) => { readonly stop: () => void };
}) {
  let stopped = false,
    pending: Promise<void> | null = null;
  const run = () => {
    if (stopped || pending) return pending ?? Promise.resolve();
    pending = Promise.resolve()
      .then(input.recover)
      .then(() => {})
      .catch(input.failed)
      .finally(() => {
        pending = null;
      });
    return pending;
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
      await pending;
    },
  };
}
