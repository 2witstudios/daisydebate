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
  MAX_FORMAT_SEATS,
  formatSeatsSchema,
  formatDefinitionSchema,
  roundRulesSchema,
  segmentTypes,
} from './format';
export type { FormatDefinition, RoundRules, SegmentType } from './format';
export {
  freezeRoomConfig,
  freezeRoomExecutionPlan,
  frozenRoomConfigSchema,
  roomConfigSchema,
  roomExecutionPlanSchema,
} from './room';
export type { FrozenRoomConfig } from './room';
export {
  resolutionCategories,
  resolutionDrawManifestSchema,
} from './resolution-draw';
export type {
  DrawPrivateInputs,
  ResolutionCategory,
  ResolutionDrawItem,
  ResolutionDrawManifest,
  ResolutionDrawState,
  ResolutionDrawView,
  ResolutionStrike,
  SideControllers,
} from './resolution-draw';
export {
  CAPTURE_CALL_DEADLINE_MS,
  CAPTURE_COVERAGE_TOLERANCE,
  CAPTURE_HISTORY_READ_MS,
  CAPTURE_STT_LAG_MS,
  CAPTURE_STT_TIMEOUT_MS,
  TRANSCRIPT_ADMISSION_WINDOW_MS,
} from './capture-timing';
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
  RoundSpeakingChange,
  RoundPosition,
} from './runtime';
export {
  competitionTypes,
  seatSlotsComplete,
  roundStatuses,
  roundStatusSchema,
  roundStageSchema,
  runtimeCheckpointSchema,
  emptyRuntimeCheckpoint,
} from './round';
export type {
  CompetitionType,
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
  topicChoices,
  wantChoices,
  type Club,
  type Experience,
  type Format,
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
  roomListQuerySchema,
  roomListPageSchema,
  roomListStatuses,
} from './room-contract';
export type {
  RoomListQuery,
  RoomListStatus,
  RoomListEntry,
  RoomListPage,
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

export {
  isNamedSeat,
  roundViewSchema,
  type LaunchedRound,
  type RoundSeat,
  type RoundView,
} from './round-view';

export {
  roomViewSchema,
  roomCatalogChoiceSchema,
  roomCastChoiceSchema,
  roomRefusalSchema,
} from './room-read';

export {
  activeRoomHref,
  activeRoomSchema,
  activeRoomReadSchema,
  type ActiveRoom,
  type ActiveRoomFacts,
  type ActiveRoomPhase,
} from './active-room';

export { serverMessageSchema, type ServerMessage } from './realtime-server';

export { createMessagingFileSchemas } from './messaging/files';

export { createMessagingInboxSchemas } from './messaging/inbox';

export {
  messagingGroupInvitationResultSchema,
  messagingGroupCreationResultSchema,
  messagingContactBlockResultSchema,
} from './messaging/social';
export { parseUsername } from './username';

export { messagingPreferenceSchemas } from './messaging/preferences';
export { messagingTypingSchemas } from './messaging/typing';

export {
  createMessagingReactionSchemas,
  type MessagingReactionPolicy,
} from './messaging/reactions';

export { roundCommandEnvelopeSchema } from './round-command';
export type {
  RoundCommandAuthority,
  RoundCommandEnvelope,
  RoundCommandPrincipal,
  RoundCommandReceipt,
  RoundCommandResponse,
  RoundRefusal,
} from './round-command';
export {
  roundBallotEnvelopeSchema,
  roundBallotReceiptSchema,
} from './round-ballot';
export type {
  RoundBallotEnvelope,
  RoundBallotReceipt,
  RoundBallotAuthority,
} from './round-ballot';
export {
  roundMediaStateSchema,
  roundMediaAdmissionSchema,
} from './round-media';
export type { RoundMediaState, RoundMediaAdmission } from './round-media';
export {
  attendanceTimingPolicy,
  availabilityRecoveryPolicy,
  attendanceEnvelopeSchema,
  attendanceReceiptSchema,
  type AttendanceEnvelope,
  type AttendanceReceipt,
} from './attendance';
export {
  roundBallotReadSchema,
  roundJudgeAssignmentsSchema,
} from './round-ballot-read';
export type {
  RoundBallotRead,
  RoundCoaching,
  RoundJudgeAssignment,
} from './round-ballot-read';
export {
  roundUnjudgedReceiptSchema,
  type RoundUnjudgedReceipt,
  type RoundUnjudgedCompletion,
} from './round-unjudged';

export {
  matchHistoryQuerySchema,
  type DebateRecord,
  type JudgePanel,
  type MatchHistoryEntry,
  type MatchHistoryQuery,
  type MemberProfile,
  type RecordResult,
} from './member-profile';
