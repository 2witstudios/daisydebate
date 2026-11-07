/** Original clock observations are provenance, never speech admission or peer hearing. */
export type ClockCalibration = {
  readonly sentAtMs: number;
  readonly receivedAtMs: number;
  readonly serverNowMs: number;
  readonly precisionMs?: number;
};
export type FrameObservation = {
  readonly sequence: number;
  readonly beforeMs: number;
  readonly afterMs: number;
};
export type FrameRunAnchor = {
  readonly calibration: ClockCalibration;
  readonly observation: FrameObservation;
  readonly previous: {
    readonly sequence: number;
    readonly nominalStartMs: number;
  } | null;
};
export type FrameClockEvidence = {
  readonly observation: FrameObservation;
  readonly anchor: FrameRunAnchor;
  readonly previous: {
    readonly sequence: number;
    readonly nominalStartMs: number;
  } | null;
  readonly window: {
    readonly beforeMs: number;
    readonly afterMs: number;
    readonly nominalStartMs: number;
  };
};
