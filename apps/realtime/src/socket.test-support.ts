import type { Waits } from '@daisy/clock';
import { virtualClock } from '@daisy/clock/testing';

/**
 * Virtual time for the socket lifecycle that also records each one-shot
 * deadline it arms: `scheduled` holds every sleep's length, `armed` each
 * sleep with its signal, and `cleared` counts the deadlines cancelled
 * before they fired.
 */
export function recordingWaits() {
  const clock = virtualClock();
  const armed: { readonly ms: number; readonly signal?: AbortSignal }[] = [];
  const scheduled: number[] = [];
  const waits: Waits = {
    ...clock,
    sleep: (ms, signal) => {
      scheduled.push(ms);
      armed.push(signal ? { ms, signal } : { ms });
      return clock.sleep(ms, signal);
    },
  };
  return {
    clock,
    waits,
    armed,
    scheduled,
    cleared: () => armed.filter((entry) => entry.signal?.aborted).length,
  };
}
