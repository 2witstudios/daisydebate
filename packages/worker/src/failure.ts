/** Where a worker reports a failure it recovers from. */
export type FailureSink = (error: unknown) => void;

/** Reports `error`; a sink that throws never stops the worker that called it. */
export const report = (failed: FailureSink, error: unknown): void => {
  try {
    failed(error);
  } catch {
    /* The next failure reports again. */
  }
};
