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
} from './format';
export type { FormatDefinition, RoundRules, SegmentType } from './format';
export { roomConfigSchema, roomExecutionPlanSchema } from './room';
export type { RoomConfig, RoomExecutionPlan } from './room';
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
  seatSlotsComplete,
  roundLengths,
  roundLengthSchema,
  roundStatuses,
  roundStatusSchema,
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
  ballotDefaultScore,
  ballotLimits,
  ballotScoreMax,
  isLowPointWin,
  ballotScoresSchema,
  ballotFeedbackSchema,
  ballotCitationsSchema,
  ballotRubric,
  ballotRubricVersion,
  ballotCategories,
  speakerTotal,
} from './ballot';
export type { Ballot, BallotCategory } from './ballot';
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
export {
  parseTopic,
  buildUserInboxTopic,
  buildDebateTopic,
  buildChannelTopic,
  buildRoomTopic,
} from './topics';
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
  isPayloadDeliverableOnTopic,
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

export {
  roomCreateSchema,
  roomCommandSchema,
  roomStatuses,
} from './room-contract';
export type {
  RoomCreate,
  RoomCommand,
  RoomParticipant,
  RoomRefusal,
  RoomView,
  RoomCommandReceipt,
  RoomCommandResponse,
  RoomCatalogChoice,
} from './room-contract';

// Persistent messaging contracts; bounds come from the owning policy.
export { createMessagingCoreSchemas } from './messaging/core';
export type { MessagingCoreBounds } from './messaging/core';
export {
  createMessagingSocialSchemas,
  messagingDmResultSchema,
  messagingDmDecisionResultSchema,
} from './messaging/social';
export type { MessagingSocialBounds } from './messaging/social';
export type {
  RoomAssemblyState,
  RoomConsent,
  RoomMutationOutcome,
  RoomCastChoice,
} from './room-contract';

export { roundViewSchema, type RoundView } from './round-view';

export {
  roomViewSchema,
  roomCatalogChoiceSchema,
  roomCastChoiceSchema,
} from './room-read';

export { serverMessageSchema, type ServerMessage } from './realtime-server';

export { createMessagingFileSchemas } from './messaging/files';

export { createMessagingInboxSchemas } from './messaging/inbox';

export { messagingGroupInvitationResultSchema } from './messaging/social';
export { parseUsername } from './username';
