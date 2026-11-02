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
