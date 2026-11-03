import { z } from 'zod';

/**
 * What a capture worker must tell apart. `timeline-open` is the one seal
 * refusal it may resend (VIDEO-4.1-r1). `capture-closed` ends it for good,
 * never relaunched (ISSUE-494). `capture-paused` is a window a clean reconcile
 * reopens, never named closed (DEC-209, ISSUE-494-r3). `lease-expired` may
 * still be reinstated by its worker: only a takeover makes it final.
 */
export const captureRefusalSchema = z.enum([
  'timeline-open',
  'capture-closed',
  'capture-paused',
  'lease-expired',
]);
export type CaptureRefusal = z.infer<typeof captureRefusalSchema>;
