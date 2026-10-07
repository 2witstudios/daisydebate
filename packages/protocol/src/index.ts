import { z } from 'zod';
/** A format's slug identity (`formats.id`): lowercase, digits and hyphens. */
export const formatIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
/**
 * Named re-exports, not `export *` (AGENTS.md: explicit exports, no
 * barrels). This is `@daisy/protocol`'s only public entry point: every
 * symbol here has a consumer outside the package, and a contract piece is
 * added in the same change as its first consumer (knip's
 * `includeEntryExports` fails an export nobody imports).
 */
export {
  idSchema,
  debateSides,
  debateRoles,
  ratingLadders,
  errorSchema,
} from './primitives';
export type {
  DebateRole,
  DebateSide,
  ProtocolError,
  RatingLadder,
} from './primitives';
export {
  formatDefinitionSchema,
  roundRulesSchema,
  segmentTypes,
  crossExModes,
  interruptionModes,
} from './format';
export type {
  FormatDefinition,
  RoundRules,
  SegmentType,
  CrossExMode,
  InterruptionMode,
} from './format';
export { roomConfigSchema, roomExecutionPlanSchema } from './room';
export type { RoomConfig, RoomExecutionPlan } from './room';
export { roundCommandSchema } from './runtime';
export type {
  HydratedRound,
  HydratedSegment,
  RoundParticipantSeat,
  RoundCommand,
  SegmentInsert,
  SegmentClose,
  RoundEffect,
  RoundProjection,
  RoundPosition,
} from './runtime';
export {
  competitionTypes,
  competitionTypeSchema,
  roundLengths,
  roundLengthSchema,
  roundStatuses,
  roundStatusSchema,
  roundStages,
  roundStageSchema,
  runtimeCheckpointSchema,
  emptyRuntimeCheckpoint,
} from './round';
export type {
  CompetitionType,
  RoundLength,
  RoundStatus,
  RoundStage,
  RuntimeCheckpoint,
} from './round';
export {
  ballotSchema,
  ballotScoresSchema,
  ballotFeedbackSchema,
  ballotCitationsSchema,
  ballotRubric,
  ballotRubricVersion,
  ballotCategories,
  ballotDefaultScore,
  ballotScoreMax,
  ballotLimits,
  speakerTotal,
  isLowPointWin,
} from './ballot';
export type { Ballot, BallotScores, BallotCategory } from './ballot';
export type {
  DebaterStanding,
  PlannedRatingChange,
  RatedOutcome,
  RatingEligibility,
  RatingEligibilityFacts,
  RatingPlan,
  RatingPlanFacts,
  RatingState,
  RatingUnrated,
} from './ratings';
export { buildUserInboxTopic, buildDebateTopic } from './topics';
export {
  emailDeliveryStatuses,
  emailDeliveryStatusRank,
  emailSuppressionReasons,
} from './email-delivery';
export type {
  EmailDeliveryStatus,
  EmailSuppressionReason,
} from './email-delivery';
export {
  clubChoices,
  experienceChoices,
  formatChoices,
  lengthChoices,
  topicChoices,
  wantChoices,
  type Club,
  type Experience,
  type Format,
  type Length,
  type Topic,
  type Want,
} from './onboarding';
export { closeCodeTable } from './close-codes';
export type { CloseCodeReason } from './close-codes';
export {
  outboxPayloadSchema,
  isPayloadStorableOnTopic,
} from './realtime-payloads';
export {
  ENVELOPE_VERSION,
  PROTOCOL_VERSION,
  heartbeatMs,
  cursorSchema,
  presenceActivitySchema,
  presenceStatuses,
  clientMessageSchema,
  ticketSchema,
} from './realtime';
export type { PresenceActivity, PresenceStatus } from './realtime';
