export { mediaBindingRevoked } from './media-binding-authority';
export {
  privateSpanChanges,
  publicClips,
  publicIntervals,
  settledByHeartbeat,
  stageTimeline,
  startEdgeLagMs,
  wholeSegmentsInside,
  type PublicClip,
  type PublicInterval,
  type StageInterval,
} from './public-interval';
/**
 * Named re-exports, not `export *` (docs/architecture/rules.md: explicit exports,
 * no barrels). This is `@daisy/protocol`'s only public entry point: every
 * symbol here has a consumer outside the package, and a contract piece is
 * added in the same change as its first consumer (knip's
 * `includeEntryExports` fails an export nobody imports).
 */
export { assertNever } from './assert-never';
export { segmentDueAtMs, speakingEndMs } from './segment-end';
export { isSpokenPrefix, spokenPrefix } from './authored-speech';
export { dueAfterStops, runningMs } from './clock-stops';
export type { ClockStop } from './clock-stops';
export {
  idSchema,
  ratingStyles,
  canonicalRatingStyle,
  errorSchema,
} from './primitives';
export type { ProtocolError, RatingStyle } from './primitives';
export {
  YOUTH_CARRY_MONTHS,
  ageBands,
  daisyLadders,
  divisionOfAgeBand,
  ladderKey,
  ratingDivisions,
  ratingDivisionForAgeRule,
  roundCompetition,
} from './ladder';
export type { AgeBand, Ladder, RatingDivision } from './ladder';
export { isYouthRound, type LiveStanding } from './youth-round';
export { aiRoleFits, aiRoleOfSeat } from './ai-roles';
export type { AiRole } from './ai-roles';
export {
  affirmativeSide,
  fourTeams,
  isDebatingSeat,
  isJudgeSeat,
  isModeratorSeat,
  isSideSeat,
  isSpeakingSeat,
  isTwoSided,
  judgeSeat,
  negativeSide,
  otherSide,
  sameSeat,
  seatKey,
  seatKindSchema,
  seatKinds,
  seatLabel,
  seatOrder,
  seatRefSchema,
  sideOfSeat,
  sideSeat,
  twoSideKeys,
  twoSides,
} from './seats';
export type {
  SeatKind,
  SeatRef,
  Side,
  SideKey,
  SideSeat,
  TwoSideKey,
} from './seats';
export {
  MAX_FORMAT_SEATS,
  everySeatOf,
  heldSeatsComplete,
  leadSeatOf,
  seatCountFor,
  seatExists,
  seatsOfKind,
  seatTotalOf,
  sideKeysOf,
  speakingSeatsOf,
} from './format-seating';
export type { FormatSeating, SpeakRights } from './format-seating';
export {
  rateableOutcome,
  roundOutcomeSchema,
  winnerOutcome,
  winningSideOf,
} from './round-outcome';
export type { RoundOutcome, WinnerOutcome } from './round-outcome';
export {
  formatDefinitionSchema,
  formatSeatsSchema,
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
  CONTENT_MODERATION_DELIVERY_BOUND_MS,
  contentReportCreateSchema,
  reasonsForTarget,
} from './content-moderation';
export type {
  ContentReportCreate,
  ContentReportReason,
  ContentReportTargetKind,
} from './content-moderation';
export { roomCaptureSchema } from './room-capture';
export type { RecordingPolicy, RoomCapture } from './room-capture';
export { formatSettingsSchema } from './format-settings';
export type { RoomResolutionSelection } from './room-resolution';
export type { FormatSettings } from './format-settings';
export type {
  HydratedRound,
  HydratedSegment,
  RoundParticipantSeat,
  RoundCommand,
  SegmentInsert,
  SegmentClose,
  RoundEffect,
  RoundIncidentChange,
  RoundProjection,
  RoundSpeakingChange,
  RoundPosition,
} from './runtime';
export {
  competitionTypes,
  seatSlotsComplete,
  roundStatus,
  roundStatuses,
  overRoundStatuses,
  roundStatusSchema,
  runningRoundStatuses,
  isRoundRunning,
  roundBegan,
  roundDecisionReleases,
  type RoundDecisionRelease,
  isRoundOver,
  isRoundCompleted,
  roundStageSchema,
  runtimeCheckpointSchema,
  emptyRuntimeCheckpointFor,
  isAbsentSeat,
  prepConsumedOf,
  clockStopsOf,
  platformIncidentCauses,
} from './round';
export {
  isRoundEndState,
  isRoundLifecycle,
  roundLifecycleFault,
} from './round-lifecycle';
export type { RoundLifecycle, RoundLifecycleColumns } from './round-lifecycle';
export type {
  CompetitionType,
  RoundStatus,
  RunningRoundStatus,
  OverRoundStatus,
  RoundStage,
  RuntimeCheckpoint,
  RoundIncident,
  PlatformIncidentCause,
  RoundPlatformEnding,
  RoundStartGate,
} from './round';
export {
  judgingAttemptCategories,
  judgingAttemptOutcomes,
  judgingAttemptDiagnosticSchema,
  judgingBallotFields,
  judgingStages,
  type JudgingStage,
  type JudgingStageInput,
  judgingRecordedIssueLimit,
  judgingTerminalReasons,
  judgingRecoveryReasons,
  type JudgingRecoveryReason,
  type JudgingAttemptCategory,
  type JudgingAttemptOutcome,
  type JudgingAttemptDiagnostic,
  type JudgingFinish,
  type JudgingIssueCode,
  type JudgingTerminalReason,
} from './round-judging-attempt';
export {
  ballotLimits,
  ballotRubricVersion,
  ballotCategories,
  speakerTotal,
} from './ballot';
export {
  ballotDefinitionIdentity,
  ballotDefinitionSchema,
  ballotDefinitionPinSchema,
  ballotDefinitionBodySchema,
  storedBallotDefinition,
  type BallotDefinitionBody,
  daisyBallotDefinitionIds,
  daisyBallotDefinitions,
  daisyBallotFor,
  daisyWinnerBallot,
  panelRuleFor,
  roundJudgingSchema,
  daisyBallotSource,
  freezeBallotJudging,
  type BallotDefinitionSource,
} from './ballot-definition';
export type {
  BallotDefinition,
  BallotSubjects,
  RoundJudging,
} from './ballot-definition';
export {
  ballotRecordSchema,
  ballotWrittenRecordSchema,
  type BallotWrittenRecord,
  ballotTextScreeningSchema,
  type BallotTextScreening,
  ballotSchemaFor,
  ballotScoresRecordSchema,
  ballotSubjectsFor,
  feedbackSubjectOf,
  isLowPointWin,
  pointsTotal,
  storedBallotSchemaFor,
} from './ballot-schema';
export type { Ballot, BallotCompetition } from './ballot-schema';
export { caseMapSchema } from './case-map';
export type { CaseMap } from './case-map';
export type { BallotCategory } from './ballot';
export type {
  DebaterStanding,
  EndingRating,
  EndingRatingFacts,
  PlannedRatingChange,
  RatingEligibility,
  RatingEligibilityFacts,
  RatingPlan,
  RatingPlanFacts,
  RatingState,
  RatingUnrated,
  RecordedEnding,
} from './ratings';
export {
  parseTopic,
  buildUserInboxTopic,
  ONLINE_TOPIC,
  buildRoundTopic,
  buildChannelTopic,
  buildRoomTopic,
  buildLobbyTopic,
  buildLobbyHostTopic,
  buildOrganizationHostTopic,
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
  decideBetaAccessChange,
  operatorConsoleOrigin,
  type BetaAccessCommandResult,
  type BetaAccessCommandState,
  type BetaAccessDecision,
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
  ROOM_SEAT_HOLD_MS,
  freeSeatsOf,
  isOpenRoom,
  isOpenRoomStatus,
  isRoomRoundLink,
  roomRoundLinkOf,
  openRoomStatuses,
  roomCreateSchema,
  roomCommandSchema,
  roomStatus,
  roomStatuses,
  endedAssemblyRoomStatuses,
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

// Room teams and the Start round seat draw (ADR 0145).
export {
  seatDrawSchema,
  seatsTwoTeams,
  sideOfTeam,
  sidesSwappable,
  teamOfPlacement,
  teamPlacementOf,
} from './seat-draw';
export type { RoomTeam, SeatDraw } from './seat-draw';

// Persistent messaging contracts; bounds come from the owning policy.
export {
  createMessagingCoreSchemas,
  messagingReactionMaxUnits,
  messagingBetaLimits,
} from './messaging/core';
export type { MessagingCoreBounds } from './messaging/core';
export {
  createMessagingSocialSchemas,
  messagingDmResultSchema,
  messagingDmDecisionResultSchema,
  messagingChannelLifecycles,
  messagingPrivateGroupPolicySchema,
  messagingSocialCreationPolicySchema,
  messageRequestSettings,
  messageRequestSettingSchema,
} from './messaging/social';
export type {
  MessagingChannelLifecycle,
  MessagingSocialBounds,
  MessageRequestSetting,
} from './messaging/social';
export type {
  OpenRoomStatus,
  RoomAssemblyState,
  RoomRoundLink,
  RoomConsent,
  RoomMutationOutcome,
  RoomCastChoice,
} from './room-contract';

export {
  isNamedSeat,
  roundViewSchema,
  type RoundWaitingFacts,
  type RoundWaitingOn,
  type LaunchedRound,
  type RoundSeat,
  type RoundView,
} from './round-view';

export {
  botDifficulties,
  roomViewSchema,
  roomCatalogChoiceSchema,
  roomCastChoiceSchema,
  roomRefusalSchema,
  type RoomWatch,
} from './room-read';
export type { YouthLiveFact } from './youth-live';

export {
  activeRoomHref,
  activeRoomSchema,
  activeRoomReadSchema,
  type ActiveRoom,
  type ActiveRoomFacts,
} from './active-room';
export {
  hostedRoomsReadSchema,
  maxHostedRooms,
  type HostedRoom,
} from './hosted-rooms';

export { serverMessageSchema, type ServerMessage } from './realtime-server';

export { createMessagingFileSchemas } from './messaging/files';

export {
  createMessagingInboxSchemas,
  decodeMessagingInboxCursor,
  encodeMessagingInboxCursor,
  messagingInboxSearchLine,
  messagingInboxPreviewMax,
  messagingInboxTitleMax,
  messagingUnreadSchema,
  type MessagingUnread,
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
  createMessagingReactionResultSchema,
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
export {
  entitlementKinds,
  entitlementSources,
  accountEntitlementKinds,
  entitlementGrantSchema,
} from './entitlements';
export {
  tournamentHostingCoverageSchema,
  tournamentHostingGrantSchema,
} from './tournament-hosting';
export type { TournamentHostingGrant } from './tournament-hosting';
export type { EntitlementGrant, PremiumEntitlementKind } from './entitlements';
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
  friendCommandResultSchema,
  friendCommandSchemas,
  friendListSchema,
  onlineCountsSchema,
  storedFriendshipStates,
} from './friends';
export {
  chosenStatuses,
  memberStatuses,
  presenceSettingResultSchema,
  presenceSettingSchema,
} from './presence-setting';
export type {
  ChosenStatus,
  MemberPlacement,
  MemberStatus,
} from './presence-setting';
export { peopleListSchema, peopleQuerySchema } from './people-list';
export type { PeopleFilter, PeopleList, Person } from './people-list';
export {
  challengeCommandSchemas,
  challengeListSchema,
  challengeResultSchema,
} from './challenges';
export type { ChallengeList, ChallengeResult } from './challenges';
export {
  ROOM_INVITATION_TTL_MS,
  roomInvitationCommandSchemas,
  roomInvitationRefusals,
  roomInvitationStates,
  settledRoomInvitations,
  type RoomInvitationRefusal,
  type InvitationDecision,
  type InvitationEndDecision,
  type InviteeFacts,
  type PendingRoomInvitation,
  type RoomInvitationView,
} from './room-invitations';
export {
  moderationAcknowledgeSchema,
  moderationKinds,
  moderationNoticesSchema,
} from './moderation';
export type { ModerationNotice } from './moderation';
export {
  reportCommandSchema,
  reportOutcomes,
  reportReasonLabels,
  reportReasons,
  storedReportReasons,
  reportResultSchema,
  reportSurfaces,
} from './reports';
export type { ReportOutcome, ReportReason, ReportSurface } from './reports';
export {
  contactBlockResultSchema,
  contactBlockSchema,
  contactBlockUsernameSchema,
} from './contacts';
export type {
  FriendCommandResult,
  FriendList,
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
  channelHistoryView,
  channelMessageView,
  channelMessagesWindow,
  createChannelMessagesProjector,
} from './messaging/channel-messages';
export type {
  ChannelHistoryRecord,
  ChannelMessageRecord,
} from './messaging/channel-messages';
export {
  analyticsConsentSchema,
  type AnalyticsConsent,
} from './analytics-consent';
export {
  judgingPolicy,
  judgingWorkKinds,
  type JudgingWorkKind,
} from './judging-policy';
export type {
  AiSeatStanding,
  HeldBallotFacts,
  JudgingJobFacts,
  JudgingPanel,
  JudgingPanelFacts,
  JudgeRuling,
  PanelRuling,
  RoundEnding,
} from './round-panel-completion';
export {
  attendanceLedgerFactsSchema,
  type AttendanceAdjudicationFact,
  type AttendanceLedgerFacts,
} from './attendance';
export { attendanceRoundReadSchema } from './attendance';
export { type RoundRecord } from './round-view';
export { frozenCaptureGapsSchema } from './capture-gap';
export type { FrozenCaptureGaps } from './capture-gap';
export { roundMediaPolicy } from './round-media-policy';
export {
  freezePostRoundCall,
  noPostRoundCall,
  postRoundCallPolicy,
} from './post-round-call';
export type {
  MediaPhase,
  MediaWindowFacts,
  PostRoundCallFacts,
  PostRoundCallState,
} from './post-round-call';
export { broadcastLivePrefix, officialFeedPath } from './official-feed';
export {
  broadcastFeedEndReasons,
  broadcastReleasePolicySchema,
  releaseSkipsSchema,
  SPECTATOR_MARGIN_MS,
  type BroadcastFeedEndReason,
  type BroadcastReleasePolicy,
} from './broadcast';
export {
  spectatorTimelineSchema,
  type BroadcastStream,
  type BroadcastStanding,
  type SpectatorTimeline,
} from './spectator-timeline';
export {
  audienceReactionKinds,
  audienceReactionPostSchema,
  audienceSnapshotSchema,
  debaterFollowUpdateSchema,
  SPECTATOR_CHAT_UNITS,
  SPECTATOR_CHAT_WINDOW,
  spectatorChatPostSchema,
  viewerPulseSchema,
  watchHistoryUpdateSchema,
  type AudienceReactionKind,
  type AudienceSnapshot,
  type SpectatorChatMessage,
} from './audience';
export {
  defaultNotificationChoices,
  isEmailedNotificationKind,
  isUrgentNotificationKind,
  kindsAbout,
  notificationChannelsOf,
  notificationChoicePairs,
  notificationKinds,
  tournamentNotificationKinds,
  type TournamentNotificationKind,
  notificationPreferencesSchema,
  notificationSubjects,
  notificationsReadSchema,
  notificationPresentationSchema,
  notificationShellSchema,
  NOTIFICATIONS_SHELL_RECENT,
  type NotificationShell,
  defaultNotificationPresentation,
  type NotificationPresentation,
  subjectOf,
  type EmailedNotificationKind,
  type NotificationChannel,
  type NotificationChoices,
  type NotificationKind,
  type NotificationSubjectKind,
  type SubjectOf,
} from './notifications';
export {
  RECORDING_EVIDENCE_HOLD_MS,
  recordingClasses,
  recordingEligibilitySchema,
  recordingHiddenByModeration,
  recordingHoldPrefix,
  holdAttemptPrefix,
  recordingLifecycleSchema,
  recordingStatuses,
  type CoverageGap,
  type RecordingClass,
  type RecordingEligibility,
  type RecordingLifecycle,
  type RecordingMedia,
  type RecordingSource,
  type RecordingSpeech,
  type RecordingStatus,
} from './recording';
export {
  recordingObjectPrefix,
  transitionRecording,
  type RecordingEvent,
  type RecordingTransition,
} from './recording-lifecycle';
export {
  capturedMediaMs,
  recordingBuildCeilingMs,
  recordingBuildDelayed,
  recordingBuildSteps,
  recordingPreparationOf,
  type RecordingBuildProgress,
  type RecordingPreparation,
} from './recording-processing';
export {
  recordingJobStateSchema,
  recordingJobStatuses,
  type BuiltRecordingMedia,
  type RecordingJobState,
} from './recording-processing';
export { broadcastHoldPrefix } from './broadcast-hold';
export { parseHoldPlaylist, type HoldEntry } from './egress-hold-playlist';
export { roundIncidentPolicy } from './round-incident-policy';
export { roundStartPolicy, startGateInstant } from './round-start-policy';
export {
  captureWithinLimit,
  frozenCaptureColumns,
  frozenCaptureOf,
  maxUnheardShare,
  platformLostTooMuch,
  type FrozenCapture,
} from './capture-judging-limit';
export {
  capturePartialReasons,
  partialReasonsStateLoss,
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
export { conversational } from './runtime';
export type {
  MediaRoomFacts,
  MediaRoomFate,
  MediaRoomRead,
  MediaRoomRotationCause,
} from './media-room-fate';
export { mediaRoomRotationCauses } from './media-room-fate';

export {
  audienceStatePath,
  audienceStateSchema,
  latestViewerBucket,
  pulseRateFor,
  tabPulses,
  VIEWER_BUCKET_MS,
  VIEWER_BUCKET_TTL_MS,
  viewerBucketOf,
  viewersFromSample,
  VIEWER_PULSE_MS,
} from './audience-state';
export type { AudienceState } from './audience-state';
export {
  necessaryEvidencePolicy,
  type EvidenceIdentity,
  type EvidenceCustodyIdentity,
  type EvidenceCustodyReceipt,
  type EvidenceRefusal,
  type SealedEvidence,
  type NecessaryEvidenceCustody,
  type NecessaryEvidenceIngressReply,
  type NecessaryEvidenceRestoreReply,
  type NecessaryEvidenceRestore,
} from './necessary-evidence';

export type {
  ClockCalibration,
  FrameObservation,
  FrameRunAnchor,
  FrameClockEvidence,
} from './frame-clock-evidence';
export { frameClockEvidenceSchema } from './frame-clock-evidence';
export {
  canonicalCaptureEvidenceBody,
  type CaptureEvidenceBody,
} from './capture-evidence-body';

export {
  encodeEvidencePrivacyScope,
  evidencePrivacyIntentSchema,
  type EvidencePrivacyScope,
  type EvidencePrivacyIntent,
  type EvidencePrivacyIntentRecord,
} from './evidence-privacy';

export { evidenceEnvelopeSchema } from './evidence-envelope';

export {
  captureEvidenceSpeakerSchema,
  type CaptureEvidenceSpeaker,
} from './capture-evidence-speaker';
export { evidenceIngressReplySchema } from './evidence-ingress-reply';

export {
  analysisWorkBounds,
  analysisWorkSchema,
  analysisRequest,
} from './round-analysis-work';
export type { AnalysisWork, AnalysisCall } from './round-analysis-work';
export {
  advanceAnalysisWork,
  analysisUsageOutcome,
  remainingAnalysisCalls,
} from './round-analysis-lifecycle';
export type { AnalysisWorkEvent } from './round-analysis-lifecycle';

export {
  scoreScaleFor,
  sumScoreValues,
  isScoreOnScale,
  scoreUnitFor,
  scoreUnits,
  scoreLatticeValues,
  scoreLatticeSize,
  scoreValueAt,
  type ScoreUnit,
} from './score-unit';

export {
  roundCompetitionSourceSchema,
  type RoundCompetitionSource,
} from './round-competition-source';
export { aiBallotAdmissionRefusal } from './ai-ballot-admission';

export { tournamentSponsorshipVersionSchema } from './tournament-sponsorship';
export type {
  TournamentSponsorshipVersion,
  TournamentSponsorshipChange,
} from './tournament-sponsorship';

export {
  tournamentCaptureAdmissionSchema,
  tournamentCaptureExecutionBudgetMs,
} from './tournament-capture-admission';
export type {
  TournamentCaptureAdmission,
  TournamentOfficialAuthority,
} from './tournament-capture-admission';
export {
  roundJudgeAssignmentReceiptSchema,
  type RoundJudgeAssignmentReceipt,
} from './round-judge-assignment';
