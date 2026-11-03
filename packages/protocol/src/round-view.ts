import type { AttendanceLedgerFacts } from './attendance';
import type { JudgingPanelFacts } from './round-panel-completion';
import { z } from 'zod';
import { roundPlatformEndings } from './round';
import {
  idSchema,
  debateRoleSchema,
  ratingLadders,
  roundOutcomeSchema,
} from './primitives';
import { frozenRoomConfigSchema } from './room';
import {
  resolutionAuditSchema,
  resolutionDrawViewSchema,
} from './resolution-draw';
import { roundRulesSchema, segmentTypes } from './format';
import {
  competitionTypes,
  roundStatusSchema,
  runtimeCheckpointSchema,
} from './round';
import { panelRulingSchema } from './round-panel-completion';

const instant = z.iso.datetime({ offset: true });

const seatSchema = z.strictObject({
  id: idSchema,
  actorId: idSchema,
  kind: z.enum(['human', 'bot']),
  label: z.string(),
  role: debateRoleSchema,
  slot: z.int().nonnegative(),
});

/**
 * A human judge's seat for a viewer who may not know who judges (DEC-98,
 * DEC-174): no name, actor or participant identity, only that it is filled.
 */
const anonymousJudgeSchema = z.strictObject({
  role: z.literal('judge'),
  kind: z.literal('human'),
  slot: z.int().nonnegative(),
  anonymous: z.literal(true),
});

/** What a played Round is waiting on. Only a state with a persisted deadline carries one. */
export const roundWaitingOnSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('closing_transcript') }),
  z.strictObject({ state: z.literal('human_window'), deadlineAt: instant }),
  z.strictObject({ state: z.literal('ai_processing'), deadlineAt: instant }),
  z.strictObject({ state: z.literal('ai_failed') }),
  z.strictObject({
    state: z.literal('awaiting_attendance'),
    deadlineAt: instant,
  }),
  z.strictObject({ state: z.literal('held_by_writer') }),
  z.strictObject({ state: z.literal('settling') }),
]);
export type RoundWaitingOn = z.infer<typeof roundWaitingOnSchema>;
/** Facts the read supplies so the engine can decide what a Round is waiting on. */
export type RoundWaitingFacts =
  | { readonly speeches: 'running' }
  | {
      readonly speeches: 'ended';
      readonly nowMs: number;
      readonly attendance: AttendanceLedgerFacts;
      /** Null until the transcript freezes. */
      readonly frozen: JudgingPanelFacts | null;
    };

/**
 * A Round's opening as one viewer reads it (ADR 0104). `complete` means every
 * step has run and the Round is about to become active. The draw stays visible
 * through prep, so a debater can see how the resolution was chosen.
 */
const roundOpeningViewSchema = z.strictObject({
  step: z.discriminatedUnion('step', [
    z.strictObject({ step: z.literal('strike') }),
    z.strictObject({
      step: z.literal('prep'),
      startedAt: instant,
      endsAt: instant,
      remainingMs: z.int().min(0),
    }),
    z.strictObject({ step: z.literal('complete'), at: instant }),
  ]),
  draw: resolutionDrawViewSchema.nullable(),
  /** The strike turn this viewer may take now. */
  canStrike: z.boolean(),
});

/**
 * One viewer's Round: the durable Launch read grammar plus the runtime
 * snapshot (checkpoint and segment rows, in sequence order) a client derives
 * the live position from with the shared reader
 * (`@daisy/debate-engine/position`); no position is precomputed. It never
 * carries the host's actor, and a human judge's identity only for that
 * judge or the host.
 */
export const roundViewSchema = z.strictObject({
  id: idSchema,
  roomId: idSchema,
  version: z.int().positive(),
  status: roundStatusSchema,
  competitionType: z.enum(competitionTypes),
  ladderId: z.enum(ratingLadders).nullable(),
  /** Null until a draw's reveal; stays null when a Round ended before its reveal. */
  topic: z.string().min(1).nullable(),
  /** Where the opening stands for this viewer; null once the Round leaves it. */
  opening: roundOpeningViewSchema.nullable(),
  visibility: z.enum(['public', 'unlisted', 'private']),
  config: frozenRoomConfigSchema,
  rules: roundRulesSchema,
  participants: z.array(z.union([seatSchema, anonymousJudgeSchema])).readonly(),
  startedAt: instant.nullable(),
  completedAt: instant.nullable(),
  outcome: roundOutcomeSchema.nullable(),
  /** The panel completion's ruling, from its durable receipt; null for any other completion. */
  panelRuling: panelRulingSchema.nullable(),
  /** The platform ended this Round: no outcome, no rating, no penalty, no charge. */
  platformEnding: z.enum(roundPlatformEndings).nullable(),
  /** What a played Round is waiting on; null until its speeches end. */
  waitingOn: roundWaitingOnSchema.nullable(),
  /** The frozen transcript's completeness; null until it freezes. */
  transcriptCompleteness: z.enum(['complete', 'incomplete']).nullable(),
  /** Whether this viewer hosts the Round; never which actor does. */
  viewerIsHost: z.boolean(),
  /** Set by the Round read from `round.observe.undelayed`; absent means no. */
  viewerIsUndelayedObserver: z.boolean().optional(),
  /** The audience stream may still receive this Round, so conversation waits. */
  conversationHeld: z.boolean().optional(),
  /** The draw's public envelope once the Round has ended; null otherwise. */
  resolutionAudit: resolutionAuditSchema.nullable(),
  /** Null when the stored checkpoint is unreadable: no live position, not an error. */
  checkpoint: runtimeCheckpointSchema.nullable(),
  segments: z
    .array(
      z.strictObject({
        id: idSchema,
        sequence: z.int().nonnegative(),
        type: z.enum(segmentTypes),
        rulesSegmentKey: z.string().min(1),
        startedAt: instant,
        endedAt: instant.nullable(),
        durationMs: z.int().positive(),
        returnedMs: z.int().nonnegative(),
      }),
    )
    .refine(
      (rows) => rows.every((row, i) => row.sequence === i),
      'Segments are in sequence order from 0',
    )
    .readonly(),
});
export type RoundView = z.infer<typeof roundViewSchema>;
/**
 * A Round as a transcript read carries it: the record, with no claim
 * about what a played Round is waiting on. Only the Round read decides that.
 */
export const roundRecordSchema = roundViewSchema.omit({ waitingOn: true });
export type RoundRecord = z.infer<typeof roundRecordSchema>;
export type RoundSeat = z.infer<typeof seatSchema>;

/**
 * The Round as stored, before projection for a viewer: every seat named
 * and the host's actor. Authorization reads it; it never leaves the server.
 */
export type LaunchedRound = Omit<
  RoundView,
  'participants' | 'viewerIsHost' | 'opening' | 'waitingOn'
> & {
  readonly hostActorId: string | null;
  /** The host took over from a restricted one, and names no human judge (DEC-331). */
  readonly hostInherited: boolean;
  readonly participants: readonly RoundSeat[];
};

/** A seat that names its occupant; an anonymous judge seat does not. */
export const isNamedSeat = <T extends object>(
  seat: T,
): seat is Exclude<T, { readonly anonymous: true }> => !('anonymous' in seat);
