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
/**
 * Whether a partial stream lost audio. Any other reason can mean nothing was
 * said, which is a silent seat and never the platform's failure.
 */
export const partialReasonsStateLoss = (reasons: readonly string[]): boolean =>
  reasons.some(
    (reason) => reason === 'frames-lost' || reason === 'session-interrupted',
  );
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
};
/** One seat's grant in one segment, as read for the engine's rule. */
export type SeatGrantFacts = {
  readonly seat: {
    readonly kind: 'human' | 'bot';
    readonly role: string;
    readonly slot: number;
  };
  /** The frozen rules' entry for the grant's segment, when they can name one. */
  readonly turn:
    | { readonly side?: string | undefined; readonly slot?: number | undefined }
    | undefined;
  /** The seat authored speech in the grant's segment (ADR 0122). */
  readonly hasAuthoredSpeech: boolean;
};

/**
 * The engine's capture decisions, injected into the adapter, which reads
 * intervals and writes the seal and never decides what the evidence amounts to.
 */
export type CaptureRule = {
  readonly decideStreamCapture: (facts: CaptureFacts) => CaptureVerdict;
  /** Whether a bot's grant owes no stream. The freeze asks it. */
  readonly botGrantUnused: (facts: SeatGrantFacts) => boolean;
  /**
   * What the tolerances forgave at a speech's edges: unheard all the same, so it is stated,
   * though it never decides a verdict or what a judge may rule on.
   */
  readonly edges: (
    coverage: StreamCoverage,
    observed: readonly CaptureInterval[],
  ) => readonly CaptureGap[];
  /** Where a closed stream's required speech has no capture. */
  readonly gaps: (
    coverage: StreamCoverage,
    observed: readonly CaptureInterval[],
  ) => readonly CaptureGap[];
  /**
   * What a human seat's stream must cover and how far its edges may move
   * (DEC-218, DEC-220): its speaking grants. A bot's transcript is authored,
   * so it owes no captured coverage (ADR 0122).
   */
  readonly coverage: (grants: readonly CaptureInterval[]) => StreamCoverage;
};
