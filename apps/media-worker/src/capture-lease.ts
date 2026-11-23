import { waitsOf } from '@daisy/clock';
import { createAppError } from '@daisy/errors';
import { isTransientControlFailure } from '@daisy/media/worker';
import { holdLease } from '@daisy/worker';
import type { CaptureClient } from './capture-history';
import { CAPTURE_OUTAGE_BUDGET_MS } from './capture-memory';

const RENEW_EVERY_MS = 5000;
/** How soon a renewal the control plane could not answer is tried again. */
const RENEW_RETRY_MS = 1000;
const LEASE_MS = 15000;

/**
 * Independent of history, native work and graceful draining; epoch authority
 * never transfers. A control plane that cannot answer is no refusal: renewal
 * keeps asking, and the server admits no write while the lease is expired
 * (it reinstates the same epoch once it answers again). A refusal ends it,
 * and so does the outage budget.
 * Resolves when `signal` aborts; rejects with the refusal, or the last
 * unanswered renewal's error, when the lease is lost.
 */
export async function maintainCaptureLease(input: {
  readonly epoch: number;
  readonly signal: AbortSignal;
  readonly lease: CaptureClient['lease'];
  readonly nowMs: () => number;
  readonly waitUntilMs: (due: number, signal: AbortSignal) => Promise<void>;
}) {
  const waits = waitsOf(input);
  let refusal: unknown = null;
  let unanswered: unknown = null;
  const lease = holdLease({
    waits,
    facts: undefined,
    renewEveryMs: RENEW_EVERY_MS,
    retryMs: RENEW_RETRY_MS,
    // The budget runs from the first renewal left unanswered, which comes at
    // most one cadence after the last that held.
    horizonMs: CAPTURE_OUTAGE_BUDGET_MS + RENEW_EVERY_MS,
    renew: async (signal) => {
      const renewed = await input.lease(LEASE_MS, signal, input.epoch);
      if (renewed.epoch !== input.epoch)
        throw createAppError('CONFLICT', 'Capture epoch changed');
      return { kind: 'held', facts: undefined };
    },
    lossOf: (error) => {
      if (isTransientControlFailure(error)) return null;
      refusal = error;
      return 'taken';
    },
    failed: (error) => {
      unanswered = error;
    },
  });
  const stopped = new Promise<'stopped'>((resolve) => {
    if (input.signal.aborted) resolve('stopped');
    else
      input.signal.addEventListener('abort', () => resolve('stopped'), {
        once: true,
      });
  });
  const end = await Promise.race([lease.ended, stopped]);
  await lease.stop();
  if (end === 'stopped' || input.signal.aborted) return;
  throw end === 'expired' ? unanswered : refusal;
}
