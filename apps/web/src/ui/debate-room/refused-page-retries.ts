/** No wait grows past this: a live Round's page must still come back soon. */
const LONGEST_WAIT_MS = 10_000;

/**
 * Asks the server again, waiting longer each time, until the caller stops: a
 * refused page goes away by being replaced, and a member moving on stops it.
 */
export function startRefusedPageRetries(input: {
  readonly firstWaitMs: number;
  readonly refresh: () => void;
  /** Runs its argument after the wait; the answer cancels that. */
  readonly schedule: (next: () => void, waitMs: number) => () => void;
}): () => void {
  let cancel = () => {};
  const waitThenRefresh = (waitMs: number) => {
    cancel = input.schedule(() => {
      input.refresh();
      waitThenRefresh(Math.min(waitMs * 2, LONGEST_WAIT_MS));
    }, waitMs);
  };
  waitThenRefresh(input.firstWaitMs);
  return () => cancel();
}
