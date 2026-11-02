import type { CaptureGap, CaptureVerdict } from '@daisy/protocol';

export type CaptureInterval = {
  readonly start: number;
  readonly end: number | null;
};
export type StreamCoverage = {
  readonly authority: readonly CaptureInterval[];
  readonly tolerance: {
    readonly openMs: number;
    readonly closeMs: number;
    readonly terminalCloseMs?: number;
  };
};
/**
 * The engine's capture decisions, injected: this adapter reads intervals and
 * writes the seal, and never decides what a stream's evidence amounts to.
 */
export type CaptureRule = {
  readonly decideStreamCapture: (
    facts: StreamCoverage & {
      readonly interrupted?: boolean;
      readonly framesLost?: boolean;
      readonly epoch: number;
      readonly observations: readonly {
        readonly start: number;
        readonly end: number;
        readonly epoch: number;
      }[];
      readonly chunks:
        | { readonly count: number; readonly otherEpochChunks: number }
        | undefined;
      readonly storedChunks: number;
      readonly expectedChunks: number;
      readonly grantUnused?: boolean;
    },
  ) => CaptureVerdict;
  readonly gaps: (
    coverage: StreamCoverage,
    observed: readonly CaptureInterval[],
  ) => readonly CaptureGap[];
  readonly coverage: (
    kind: 'human' | 'bot',
    grants: readonly CaptureInterval[],
    botWindows: readonly CaptureGap[],
  ) => StreamCoverage;
};
