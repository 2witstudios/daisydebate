import { createAppError } from '@daisy/errors';
import { isTransientControlFailure } from '@daisy/media/worker';
import type { CaptureClient } from './capture-history';

const RENEW_EVERY_MS = 5000;
/** How soon a renewal the control plane could not answer is tried again. */
const RENEW_RETRY_MS = 1000;

/**
 * Independent of history, native work and graceful draining; epoch authority
 * never transfers. A control plane that cannot answer is no refusal: renewal
 * keeps asking, and the server admits no write while the lease is expired. Only
 * an answer ends it.
 */
export async function maintainCaptureLease(input: {
  readonly epoch: number;
  readonly signal: AbortSignal;
  readonly lease: CaptureClient['lease'];
  readonly nowMs: () => number;
  readonly waitUntilMs: (due: number, signal: AbortSignal) => Promise<void>;
}) {
  let pauseMs = RENEW_EVERY_MS;
  while (!input.signal.aborted) {
    await input
      .waitUntilMs(input.nowMs() + pauseMs, input.signal)
      .catch((error) => {
        if (!input.signal.aborted) throw error;
      });
    if (input.signal.aborted) return;
    try {
      const renewed = await input.lease(15000, input.signal, input.epoch);
      if (renewed.epoch !== input.epoch)
        throw createAppError('CONFLICT', 'Capture epoch changed');
      pauseMs = RENEW_EVERY_MS;
    } catch (error) {
      if (input.signal.aborted) return;
      if (!isTransientControlFailure(error)) throw error;
      pauseMs = RENEW_RETRY_MS;
    }
  }
}
