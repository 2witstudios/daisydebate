import { createAppError } from '@daisy/errors';
import type { CaptureClient } from './capture-history';

/** Independent of history, native work and graceful draining; epoch authority never transfers. */
export async function maintainCaptureLease(input: {
  readonly epoch: number;
  readonly signal: AbortSignal;
  readonly lease: CaptureClient['lease'];
  readonly nowMs: () => number;
  readonly waitUntilMs: (due: number, signal: AbortSignal) => Promise<void>;
}) {
  while (!input.signal.aborted) {
    await input
      .waitUntilMs(input.nowMs() + 5000, input.signal)
      .catch((error) => {
        if (!input.signal.aborted) throw error;
      });
    if (input.signal.aborted) return;
    const renewed = await input.lease(15000, input.signal);
    if (renewed.epoch !== input.epoch)
      throw createAppError('CONFLICT', 'Capture epoch changed');
  }
}
