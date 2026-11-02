/** Runs every step whatever the others do, then reports all that failed together. */
export async function runEveryStep(
  steps: readonly (() => Promise<unknown>)[],
): Promise<void> {
  const failures: unknown[] = [];
  for (const step of steps) {
    try {
      await step();
    } catch (failure) {
      failures.push(failure);
    }
  }
  if (failures.length > 0)
    throw new AggregateError(
      failures,
      `Teardown failed: ${failures.map(String).join('; ')}`,
    );
}

/**
 * A teardown failure is reported beside the test's own outcome, never thrown from a
 * `finally` where it would replace the primary failure.
 */
export const reportingTeardown =
  (close: () => Promise<void>, report: (teardown: unknown) => void) =>
  async () => {
    try {
      await close();
    } catch (teardown) {
      report(teardown);
    }
  };
