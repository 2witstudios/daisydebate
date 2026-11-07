import { z } from 'zod';

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

const finite = () => z.number();
const sequence = () => z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const previousSchema = z
  .strictObject({
    sequence: sequence(),
    nominalStartMs: z
      .number()
      .int()
      .min(-8640000000000000)
      .max(8640000000000000),
  })
  .nullable();
const observationSchema = z
  .strictObject({ sequence: sequence(), beforeMs: finite(), afterMs: finite() })
  .refine((frame) => frame.afterMs >= frame.beforeMs);
const calibrationSchema = z
  .strictObject({
    sentAtMs: finite(),
    receivedAtMs: finite(),
    serverNowMs: finite(),
    precisionMs: z.number().min(0).max(1).optional(),
  })
  .refine(
    (clock) =>
      clock.receivedAtMs >= clock.sentAtMs &&
      clock.receivedAtMs - clock.sentAtMs <= 100,
  )
  .transform(({ precisionMs, ...clock }): ClockCalibration =>
    precisionMs === undefined ? clock : { ...clock, precisionMs },
  );
/** Shape/coherence only. Original mapping equations and actual capture authority are separate checks. */
export const frameClockEvidenceSchema: z.ZodType<FrameClockEvidence> = z
  .strictObject({
    observation: observationSchema,
    anchor: z.strictObject({
      calibration: calibrationSchema,
      observation: observationSchema,
      previous: previousSchema,
    }),
    previous: previousSchema,
    window: z.strictObject({
      beforeMs: finite(),
      afterMs: finite(),
      nominalStartMs: z
        .number()
        .int()
        .min(-8640000000000000)
        .max(8640000000000000),
    }),
  })
  .refine(
    (frame) =>
      frame.window.beforeMs <= frame.window.nominalStartMs &&
      frame.window.afterMs >= frame.window.nominalStartMs + 10 &&
      frame.observation.sequence >= frame.anchor.observation.sequence,
  );
