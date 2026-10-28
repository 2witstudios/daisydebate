type Timer = {
  readonly set: (run: () => void, ms: number) => unknown;
  readonly clear: (handle: unknown) => void;
};
const processTimer: Timer = {
  set: (run, ms) => setTimeout(run, ms).unref(),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * A seat's ending deadline, two renewals inside its lease (ISSUE-789): it
 * settles when the ending runs too long, and `signal` clears its timer once
 * the ending is done. Speaking authority stays with the lease itself.
 */
export const endingDeadline =
  (
    policy: { readonly leaseMs: number; readonly renewMs: number },
    timer: Timer = processTimer,
  ) =>
  (signal: AbortSignal) =>
    new Promise<void>((resolve) => {
      const handle = timer.set(resolve, policy.leaseMs - 2 * policy.renewMs);
      signal.addEventListener('abort', () => timer.clear(handle), {
        once: true,
      });
    });
