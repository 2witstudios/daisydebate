import type { OneShotTimer } from '../../lib/worker-timers';

/**
 * A seat's ending deadline, two renewals inside its lease (ISSUE-789): it
 * settles when the ending runs too long, and `signal` clears its timer once
 * the ending is done. Speaking authority stays with the lease itself.
 */
export const endingDeadline =
  (
    policy: { readonly leaseMs: number; readonly renewMs: number },
    timer: OneShotTimer,
  ) =>
  (signal: AbortSignal) =>
    new Promise<void>((resolve) => {
      const handle = timer.setTimeout(
        resolve,
        policy.leaseMs - 2 * policy.renewMs,
      );
      signal.addEventListener('abort', () => timer.clearTimeout(handle), {
        once: true,
      });
    });
