import { z } from 'zod';
import { idSchema } from './primitives';

/** The closed vocabulary a check-in refusal answers with. */
export const attendanceRefusalSchema = z.enum([
  'attendance-terminal',
  'attendance-finalized',
  'attendance-segment',
  'attendance-window-closed',
  'attendance-too-early',
  'command-conflict',
]);
export type AttendanceRefusal = z.infer<typeof attendanceRefusalSchema>;
/** Actor/service identity is always bound server-side; no identity field is accepted. */
export const attendanceEnvelopeSchema = z.strictObject({
  version: z.literal(1),
  commandId: idSchema,
  segmentId: idSchema,
});
export type AttendanceEnvelope = z.infer<typeof attendanceEnvelopeSchema>;
export const attendanceReceiptSchema = z.strictObject({
  version: z.literal(1),
  commandId: idSchema,
  roundId: idSchema,
  segmentId: idSchema,
  participantId: idSchema,
  receivedAt: z.iso.datetime(),
  resultingVersion: z.int().positive(),
  replayed: z.boolean(),
});
export type AttendanceReceipt = z.infer<typeof attendanceReceiptSchema>;

/**
 * Only what the check-in client reads of a Round. A tab open across a deploy
 * keeps checking in through any change elsewhere in the Round view, so a present
 * speaker is never forfeited by a skewed build (ISSUE-941).
 */
export const attendanceRoundReadSchema = z.looseObject({
  id: idSchema,
  status: z.string(),
  segments: z
    .array(z.looseObject({ id: idSchema, type: z.string() }))
    .readonly(),
});

export const attendanceTimingPolicy = {
  heartbeatMs: 15000,
  reconnectBudgetMs: 10000,
  graceMs: 40000,
  leadMs: 5000,
  commitBudgetMs: 2000,
  /**
   * The execution slice of each attendance transaction, setup through
   * COMMIT: a writer opens and closes its check-in marker inside it.
   */
  transactionSliceMs: 900,
  finalizationBufferMs: 5000,
  /**
   * How long after the actual final speech end a window settled evidence still
   * cannot resolve keeps waiting (DEC-276). Well inside the 24-hour sample
   * retention, so it cannot race the evidence it waits for.
   */
  resolutionCutoffMs: 60 * 60_000,
} as const;

/**
 * When availability evidence closes an outage (ADR 0067): after this many
 * consecutive healthy samples, and a gap between samples longer than
 * maxSampleGapMs opens one. So the outage state at any instant is fixed by
 * the latest recoverySamples samples before it, which bounds how much
 * history a later decision must read (ISSUE-529).
 */
export const availabilityRecoveryPolicy = {
  recoverySamples: 3,
  maxSampleGapMs: 2000,
} as const;

/** What the attendance ledger holds for one Round, read for the engine's settlement rule. */
export type AttendanceLedgerFacts = {
  readonly ruleSegments: readonly {
    readonly key: string;
    readonly type: string;
  }[];
  readonly speeches: readonly {
    readonly id: string;
    readonly rulesSegmentKey: string | null;
    readonly startedAt: string;
  }[];
  readonly adjudications: readonly {
    readonly segmentId: string;
    readonly decision: string;
    readonly evidence: string;
    readonly effectiveDeadline: string | null;
    readonly settledHorizon: string | null;
    readonly receiptParticipantId: string | null;
  }[];
  readonly receipts: readonly {
    readonly segmentId: string;
    readonly participantId: string;
    readonly receivedAt: string;
  }[];
  /** An uncertain check-in writer holds every attendance decision. */
  readonly pendingWriter: boolean;
};
