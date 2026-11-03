import { z } from 'zod';
import { debateSideSchema, idSchema, roundOutcomeSchema } from './primitives';

/** What one AI judge seat can still do. One state per seat. */
export type AiSeatStanding =
  /** No job: an AI judge never decides from an incomplete transcript (DEC-208). */
  | { readonly state: 'not_dispatched' }
  | { readonly state: 'generating'; readonly deadlineAt: string }
  /** A validated ballot waiting for attendance and a worker to submit it. */
  | { readonly state: 'holding_ballot' }
  /** Its job ended, or ran out of budget, with no ballot. */
  | { readonly state: 'ended' }
  | { readonly state: 'succeeded' };

/**
 * The Round's judges at decision time. A human seat exists only inside a human
 * window, so a human judge with no deadline has no representation, and each AI
 * seat holds exactly one standing.
 */
export type JudgingPanel = {
  readonly humanWindow: {
    /** Persisted at the freeze (DEC-201, DEC-207). */
    readonly deadlineAt: string;
    readonly seatIds: readonly [string, ...string[]];
  } | null;
  readonly aiSeats: readonly {
    readonly id: string;
    readonly standing: AiSeatStanding;
  }[];
};
/** One judge seat's ruling: the winner it named. */
export const judgeRulingSchema = z.strictObject({
  judgeParticipantId: idSchema,
  winner: debateSideSchema,
});
export type JudgeRuling = z.infer<typeof judgeRulingSchema>;

/** One judging job as read; the engine decides what it means. */
export type JudgingJobFacts = {
  readonly judgeParticipantId: string;
  readonly status: 'queued' | 'leased' | 'succeeded' | 'failed';
  readonly generationDeadlineAt: string;
  readonly holdsBallot: boolean;
};
/** What bounds how long a held ballot may keep its Round waiting. */
export type HeldBallotFacts = {
  /** A job exists only after a freeze, so its Round's cutoff always exists. */
  readonly attendanceCutoffAt: string;
  readonly lastAttendanceDecisionAt: string | null;
  readonly lastWriterResolvedAt: string | null;
};
/** Facts read from a frozen Round, for the engine's one panel decision. */
export type JudgingPanelFacts = {
  readonly completeness: 'complete' | 'incomplete';
  readonly humanJudgeSeatIds: readonly string[];
  readonly aiJudgeSeatIds: readonly string[];
  readonly ballotDeadlineAt: string | null;
  readonly jobs: readonly JudgingJobFacts[];
  readonly held: HeldBallotFacts;
  readonly ballots: readonly JudgeRuling[];
};
/** How a Round ended, as attendance or the panel knows it. Judging names what that does to a job. */
export type RoundEnding = 'forfeit' | 'abandoned' | 'panel_closed';

/** Internal facts from the locked Round; never a public command body. */
export type RoundPanelCompletion = {
  readonly now: string;
  readonly ballots: readonly JudgeRuling[];
  /** The frozen transcript's completeness (DEC-208). */
  readonly completeness: 'complete' | 'incomplete';
  readonly panel: JudgingPanel;
};

/** Why panel completion completed a Round (DEC-201, DEC-207, DEC-208). */
export const panelRulingSchema = z.enum([
  'unjudged',
  'judges-did-not-rule',
  'transcript-incomplete',
  'judging-failed',
  'partial',
  'ruled',
  'judges-split',
]);
export type PanelRuling = z.infer<typeof panelRulingSchema>;

/**
 * One durable finalization command; replay keeps its original result. A
 * zero-judge Round is `unjudged`. Every seat ruling is `ruled`, or
 * `judges-split` when they tie, with no outcome (DEC-277). Past the ballot deadline (DEC-201) the
 * judges in `noRuling` gave no ruling: with no ballot at all the judges did
 * not rule and there is no outcome; otherwise the submitted ballots decide.
 */
export const roundPanelReceiptSchema = z.strictObject({
  version: z.literal(1),
  commandId: idSchema,
  roundId: idSchema,
  freezeRevision: z.int().positive(),
  resultingVersion: z.int().positive(),
  status: z.literal('completed'),
  ruling: panelRulingSchema,
  outcome: roundOutcomeSchema.nullable(),
  noRuling: z.array(idSchema).readonly(),
  replayed: z.boolean(),
});
export type RoundPanelReceipt = z.infer<typeof roundPanelReceiptSchema>;
