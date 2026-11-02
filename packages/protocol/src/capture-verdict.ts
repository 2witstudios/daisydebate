import { z } from 'zod';

/** Why a stream's transcript is not complete. A gap is only one of these. */
const capturePartialReasons = [
  'session-interrupted',
  'frames-lost',
  'other-worker-evidence',
  'chunks-uncounted',
  'invalid-history',
  'nothing-required',
  'coverage-gap',
  'never-sealed',
] as const;
export const capturePartialReasonSchema = z.enum(capturePartialReasons);
export type CapturePartialReason = z.infer<typeof capturePartialReasonSchema>;

export type CaptureGap = { readonly start: number; readonly end: number };
/** Complete has no reasons; partial always has at least one. */
export type CaptureVerdict =
  | { readonly state: 'complete'; readonly gaps: readonly [] }
  | {
      readonly state: 'partial';
      readonly reasons: readonly [
        CapturePartialReason,
        ...CapturePartialReason[],
      ];
      readonly gaps: readonly CaptureGap[];
    };
