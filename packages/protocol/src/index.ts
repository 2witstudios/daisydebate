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
  canonicalRatingLadder,
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
export type {
  FormatChange,
  FormatSelectionFacts,
  FormatStanding,
} from './format-standing';
export {
  freezeRoomConfig,
  freezeRoomExecutionPlan,
  frozenRoomConfigSchema,
  roomConfigSchema,
  roomExecutionPlanSchema,
} from './room';
export {
  CAPTURE_CALL_DEADLINE_MS,
  CAPTURE_COVERAGE_TOLERANCE,
  CAPTURE_HISTORY_READ_MS,
  CAPTURE_STT_LAG_MS,
  CAPTURE_STT_TIMEOUT_MS,
  TRANSCRIPT_ADMISSION_WINDOW_MS,
} from './capture-timing';
export type { RoomConfig, RoomExecutionPlan } from './room';
export {
  chatSlowModeSchema,
  MODERATION_DELIVERY_BOUND_MS,
  reasonsForTarget,
  reportCreateSchema,
} from './moderation';
export type {
  ReportCreate,
  ReportReason,
  ReportTargetKind,
} from './moderation';
export { roomCaptureSchema } from './room-capture';
export type { RoomCapture } from './room-capture';
export { formatSettingsSchema } from './format-settings';
export { publishedResolutionSchema } from './room-resolution';
export type {
  PublishedResolution,
  RoomResolutionSelection,
} from './room-resolution';
export type { FormatSettings } from './format-settings';
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
  judgingAttemptCategories,
  judgingAttemptOutcomes,
  judgingAttemptDiagnosticSchema,
  judgingBallotFields,
  judgingFinishes,
  judgingRecordedIssueLimit,
  judgingTerminalReasons,
  type JudgingAttemptCategory,
  type JudgingAttemptOutcome,
  type JudgingAttemptDiagnostic,
  type JudgingFinish,
  type JudgingIssueCode,
  type JudgingTerminalReason,
} from './round-judging-attempt';
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
  buildRoundTopic,
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
  interestCategoryChoices,
  wantChoices,
  type Club,
  type Experience,
  type InterestCategory,
  type Want,
} from './onboarding';
export {
  betaAccessProvenances,
  betaAccessCommandAction,
  betaAccessCommandResultSchema,
  betaAccessStates,
  operatorConsoleOrigin,
  type BetaAccessCommandResult,
  type BetaAccessCommandState,
  type BetaAccessState,
} from './beta-access';
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
  clientMessageSchema,
  ticketSchema,
} from './realtime';
export type { PresenceActivity } from './realtime';

export {
  roomCreateSchema,
  roomCommandSchema,
  roomStatuses,
  roomListQuerySchema,
  roomListSorts,
  roomListPageSchema,
  roomListStatuses,
  roomListDefaultPageSize,
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
export {
  createMessagingCoreSchemas,
  messagingBetaLimits,
} from './messaging/core';
export type { MessagingCoreBounds } from './messaging/core';
export {
  createMessagingSocialSchemas,
  messagingDmResultSchema,
  messagingDmDecisionResultSchema,
  messagingChannelLifecycles,
} from './messaging/social';
export type {
  MessagingChannelLifecycle,
  MessagingSocialBounds,
} from './messaging/social';
export type {
  RoomAssemblyState,
  RoomConsent,
  RoomMutationOutcome,
  RoomCastChoice,
} from './room-contract';

export {
  isNamedSeat,
  roundViewSchema,
  roundWaitingOnSchema,
  type RoundWaitingFacts,
  type RoundWaitingOn,
  type LaunchedRound,
  type RoundSeat,
  type RoundView,
} from './round-view';

export {
  AI_ROUND_MONTHLY_CAP_MAX,
  botAdmissionRefusals,
  botDifficulties,
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

export {
  createMessagingInboxSchemas,
  messagingInboxPreviewMax,
  messagingInboxTitleMax,
} from './messaging/inbox';

export {
  messagingGroupInvitationResultSchema,
  messagingGroupCreationResultSchema,
} from './messaging/social';
export { parseUsername } from './username';

export { messagingPreferenceSchemas } from './messaging/preferences';
export { messagingRetainedSchemas } from './messaging/retained';
export { messagingTypingSchemas } from './messaging/typing';

export {
  createMessagingReactionSchemas,
  type MessagingReactionPolicy,
} from './messaging/reactions';

export {
  roundCommandEnvelopeSchema,
  roundRefusalSchema,
} from './round-command';
export { captureRefusalSchema } from './capture-refusal';
export type { CaptureRefusal } from './capture-refusal';
export type { RefusalReason } from './refusal-reason';
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
  attendanceRefusalSchema,
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
  RoundJudgeAssignment,
} from './round-ballot-read';
export { entitlementKinds, entitlementSources } from './entitlements';
export type { EntitlementGrant } from './entitlements';
export {
  roundAnalysisLimits,
  roundAnalysisReportSchema,
  roundAnalysisSkills,
  roundAnalysisVersion,
  roundAnalysisViewSchema,
} from './round-analysis';
export type {
  RoundAnalysisLine,
  RoundAnalysisReport,
  RoundAnalysisSkill,
  RoundAnalysisView,
} from './round-analysis';
export {
  roundPanelReceiptSchema,
  type RoundPanelReceipt,
  type RoundPanelCompletion,
} from './round-panel-completion';

export {
  matchHistoryQuerySchema,
  type DebateRecord,
  type JudgePanel,
  type MatchHistoryEntry,
  type MatchHistoryQuery,
  type MemberProfile,
  type RecordResult,
} from './member-profile';

export {
  challengeCommandResultSchema,
  friendCommandResultSchema,
  friendCommandSchemas,
  friendListSchema,
  friendPresences,
  friendshipStates,
  onlineCountsSchema,
} from './friends';
export {
  presenceSettingResultSchema,
  presenceSettingSchema,
} from './presence-setting';
export {
  contactBlockResultSchema,
  contactBlockSchema,
  contactBlockUsernameSchema,
} from './contacts';
export type {
  ChallengeCommandResult,
  FriendCommandResult,
  FriendList,
  FriendPresence,
  FriendRelation,
  FriendshipState,
  OnlineCounts,
} from './friends';

export {
  liveTranscriptReadSchema,
  roundTranscriptReadSchema,
  TRANSCRIPT_CONTRACT_VERSION,
  type LiveTranscriptRead,
} from './round-transcript';

// Shared resource observation (ADR 0089).
export {
  observationResourceKey,
  parseObservationResourceKey,
  observationBaseSchema,
  observationFrameBytes,
  observationPermitMs,
  utf8Bytes,
} from './observation';
export type {
  ObservationBase,
  ObservationResource,
  ObservationResourceKind,
} from './observation';
export {
  channelMessageView,
  channelMessagesWindow,
  createChannelMessagesProjector,
} from './messaging/channel-messages';
export type { ChannelMessageRecord } from './messaging/channel-messages';
export {
  analyticsConsentSchema,
  type AnalyticsConsent,
} from './analytics-consent';
export { judgingPolicy } from './judging-policy';
export type {
  AiSeatStanding,
  HeldBallotFacts,
  JudgingJobFacts,
  JudgingPanel,
  JudgingPanelFacts,
  PanelRuling,
  RoundEnding,
} from './round-panel-completion';
export type { AttendanceLedgerFacts } from './attendance';
export { attendanceRoundReadSchema } from './attendance';
export { roundRecordSchema, type RoundRecord } from './round-view';
export {
  broadcastReleasePolicySchema,
  SPECTATOR_MARGIN_MS,
  type BroadcastReleasePolicy,
} from './broadcast';
export {
  spectatorTimelineSchema,
  type SpectatorTimeline,
} from './spectator-timeline';
export {
  recordingClasses,
  recordingEligibilitySchema,
  recordingFailureReasons,
  recordingLifecycleSchema,
  recordingMediaSchema,
  recordingRemovalCauses,
  recordingStatuses,
  type RecordingClass,
  type RecordingEligibility,
  type RecordingLifecycle,
  type RecordingMedia,
  type RecordingRemovalCause,
  type RecordingSpeech,
  type RecordingStatus,
} from './recording';
export {
  capturePartialReasons,
  capturePartialReasonSchema,
  type CaptureFacts,
  type CaptureGap,
  type CaptureInterval,
  type CapturePartialReason,
  type CaptureRule,
  type CaptureVerdict,
  type SeatGrantFacts,
  type CoverageEdges,
  type StreamCoverage,
} from './capture-verdict';
export {
  acknowledgedReply,
  captureMutationReply,
  captureStateReply,
  leaseReply,
  sealReply,
  tokenReply,
} from './capture-worker-replies';
