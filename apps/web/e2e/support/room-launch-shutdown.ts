type Cleanup = () => void | Promise<void>;

/** Drain actual auth work, then attempt every local cleanup even after a failure. */
export function createLaunchShutdown({
  settled,
  closeControl,
  stopCapture,
  stopEdge,
  refused,
}: {
  readonly settled: () => Promise<void>;
  readonly closeControl: Cleanup;
  readonly stopCapture: Cleanup;
  readonly stopEdge: Cleanup;
  readonly refused: () => void;
}) {
  let running: Promise<void> | undefined;
  const run = async () => {
    let failed = false;
    try {
      await settled();
    } catch {
      failed = true;
    }
    const outcomes = await Promise.allSettled(
      [closeControl, stopCapture, stopEdge].map((cleanup) =>
        Promise.resolve().then(cleanup),
      ),
    );
    if (failed || outcomes.some((outcome) => outcome.status === 'rejected'))
      refused();
  };
  return () => (running ??= run());
}
