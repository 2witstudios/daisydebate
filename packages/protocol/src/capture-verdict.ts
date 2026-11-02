import { z } from 'zod';

/** Why a stream's transcript is not complete. A gap is only one of these. */
export const capturePartialReasons = [
  'session-interrupted',
  'frames-lost',
  'other-worker-evidence',
  'chunks-uncounted',
  'invalid-history',
  'no-authority-window',
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

export type CaptureInterval = {
  readonly start: number;
  readonly end: number | null;
};
/** How far an authority window's capture may start late and end early. */
export type CoverageEdges = {
  /** Its first stretch, before speech began: the speaker has not yet heard the grant (DEC-218). */
  readonly openMs: number;
  /** Its last stretch, after speech ended: a yield reaches the server late (DEC-220). */
  readonly closeMs: number;
  /**
   * The last stretch before the authority's terminal close, for a bot's
   * credited windows only (DEC-212, ISSUE-806): the speaker cannot see the
   * cutoff, so its last windows may open after its final frame. A human's
   * grants have none, so a microphone that dies before a final grant still
   * seals partial.
   */
  readonly terminalCloseMs?: number;
};
export type StreamCoverage = {
  readonly authority: readonly CaptureInterval[];
  readonly tolerance: CoverageEdges;
};
export type CaptureFacts = StreamCoverage & {
  readonly interrupted?: boolean;
  /** The sealing process held frames it then had to drop. */
  readonly framesLost?: boolean;
  readonly epoch: number;
  readonly observations: readonly {
    readonly start: number;
    readonly end: number;
    readonly epoch: number;
  }[];
  readonly chunks:
    { readonly count: number; readonly otherEpochChunks: number } | undefined;
  readonly storedChunks: number;
  readonly expectedChunks: number;
  /** A bot's grant it did not use: with no evidence of speech, nothing was owed. */
  readonly grantUnused?: boolean;
};
/**
 * The engine's capture decisions, injected into the adapter, which reads
 * intervals and writes the seal and never decides what the evidence amounts to.
 */
export type CaptureRule = {
  readonly decideStreamCapture: (facts: CaptureFacts) => CaptureVerdict;
  /** Where a closed stream's required speech has no capture. */
  readonly gaps: (
    coverage: StreamCoverage,
    observed: readonly CaptureInterval[],
  ) => readonly CaptureGap[];
  /**
   * What a seat's stream must cover and how far its edges may move (DEC-218,
   * DEC-220): a human's speaking grants; a bot's credited publication windows.
   * Silence outside a bot's windows is not speech.
   */
  readonly coverage: (
    kind: 'human' | 'bot',
    grants: readonly CaptureInterval[],
    botWindows: readonly CaptureGap[],
  ) => StreamCoverage;
};
