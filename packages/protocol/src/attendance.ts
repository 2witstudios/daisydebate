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

/**
 * One stored decision, in the shape its evidence allows: the row
 * `round_attendance_adjudications_evidence_check` constrains. It holds what only
 * the decision knows. A forfeit's winner is the Round's outcome, written by the
 * same transaction, and an on-time receipt's instant is on the receipt it names,
 * so neither is stored twice.
 */
const attendanceAdjudicationFactSchema = z.discriminatedUnion('evidence', [
  z.object({
    segmentId: z.string(),
    evidence: z.literal('settled_availability'),
    decision: z.enum(['attended', 'none', 'forfeit', 'abandoned']),
    effectiveDeadline: z.string(),
    settledHorizon: z.string(),
  }),
  z.object({
    segmentId: z.string(),
    evidence: z.literal('on_time_receipt'),
    decision: z.literal('attended'),
    receiptParticipantId: z.string(),
  }),
  z.object({
    segmentId: z.string(),
    evidence: z.literal('resolution_cutoff'),
    decision: z.literal('abandoned'),
  }),
]);

export type AttendanceAdjudicationFact = z.infer<
  typeof attendanceAdjudicationFactSchema
>;

/** What the attendance ledger holds for one Round, read for the engine's settlement rule. */
export const attendanceLedgerFactsSchema = z.object({
  ruleSegments: z.array(z.object({ key: z.string(), type: z.string() })),
  speeches: z.array(
    z.object({
      id: z.string(),
      rulesSegmentKey: z.string().nullable(),
      startedAt: z.string(),
    }),
  ),
  adjudications: z.array(attendanceAdjudicationFactSchema),
  receipts: z.array(
    z.object({
      segmentId: z.string(),
      participantId: z.string(),
      receivedAt: z.string(),
    }),
  ),
  /** An uncertain check-in writer holds every attendance decision. */
  pendingWriter: z.boolean(),
});
export type AttendanceLedgerFacts = z.infer<typeof attendanceLedgerFactsSchema>;
