import { afterMs, type Waits } from '@daisy/clock';

/**
 * A seat's ending deadline, two renewals inside its lease (ISSUE-789): it
 * settles when the ending runs too long, and `signal` cancels its wait once
 * the ending is done. Speaking authority stays with the lease itself.
 */
export const endingDeadline =
  (
    policy: { readonly leaseMs: number; readonly renewMs: number },
    waits: Waits,
  ) =>
  (signal: AbortSignal) =>
    new Promise<void>((resolve) => {
      const cancel = afterMs(
        waits,
        policy.leaseMs - 2 * policy.renewMs,
        resolve,
      );
      signal.addEventListener('abort', cancel, { once: true });
    });
