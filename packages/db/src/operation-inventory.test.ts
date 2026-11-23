import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { virtualClock } from '@daisy/clock/testing';
import { createId } from '@paralleldrive/cuid2';
import { unreachableDatabase } from './index.test-support';
import { openDatabaseResources } from './resources';
import { createAgeStepStore } from './stores/age-step';
import { createAgreementsStore } from './stores/agreements';
import { createAnalyticsConsentStore } from './stores/analytics-consent';
import { createAttendanceStore } from './stores/attendance';
import { createAudienceReactionsStore } from './stores/audience-reactions';
import { createAuthStore } from './stores/auth';
import { createAvailabilityStore } from './stores/availability';
import { createBetaAccessStore } from './stores/beta-access';
import { createBillingStore } from './stores/billing';
import { createBroadcastStore } from './stores/broadcasts';
import { createChallengesStore } from './stores/challenges';
import { contactReactions, createContactsStore } from './stores/contacts';
import {
  contentModerationPorts,
  createContentModerationStore,
} from './stores/content-moderation';
import { createDebaterFollowsStore } from './stores/debater-follows';
import { createDocumentStore } from './stores/documents';
import { createFlagsStore } from './stores/flags';
import { createFormatsStore } from './stores/formats';
import { createFriendsStore } from './stores/friends';
import { createGuardiansStore } from './stores/guardians';
import { createHealthStore } from './stores/health';
import { createLeagueRequestsStore } from './stores/league-requests';
import { createListenStore } from './stores/listen';
import { createLobbyStore } from './stores/lobbies';
import { createMailStore } from './stores/mail';
import { createMediaCaptureStore } from './stores/media-capture';
import { createMediaReleaseStore } from './stores/media-releases';
import { createMediaSessionStore } from './stores/media-sessions';
import { createMemberDivisionStore } from './stores/member-division';
import { createMessagingStore } from './stores/messaging';
import { createModerationStore } from './stores/moderation';
import { createNotificationsStore } from './stores/notifications';
import { createOnboardingStore } from './stores/onboarding';
import { createOperatorAccountsStore } from './stores/operator-accounts';
import { createOutboxStore } from './stores/outbox';
import { createPresenceStore } from './stores/presence';
import { createPrivacyStore } from './stores/privacy';
import { createProfileStore } from './stores/profiles';
import { createRatingStore } from './stores/ratings';
import { createRecordingStore } from './stores/recordings';
import { createReportsStore, moderationReactions } from './stores/reports';
import { createRoomStore } from './stores/rooms';
import { createRoundAnalysisStore } from './stores/round-analysis';
import { createRoundBotAdmissionStore } from './stores/round-bot-admission';
import { createRoundIncidentStore } from './stores/round-incidents';
import { createRoundMaintenanceStore } from './stores/round-maintenance';
import { createRoundStartGateStore } from './stores/round-start-gates';
import { createRoundWorkerStore } from './stores/round-workers';
import { createRoundBallotStore, createRoundStore } from './stores/rounds';
import { createSpectatingStore } from './stores/spectating';
import { createSpectatorChatStore } from './stores/spectator-chat';
import { createStandingsStore } from './stores/standings';
import { createTabCommandStore } from './stores/tab';
import { createTranscriptStore } from './stores/transcripts';
import { createWatchHistoryStore } from './stores/watch-history';

setupRitewayBun();

/**
 * Every operation the composed database exposes, by the area that provides
 * it, taken from createDatabase at 17174b840 (R4.5). It is the net for the
 * split into per-area stores: no name may be dropped, gained or moved to
 * another area. A nested store's members are listed as `store.member`.
 */
const operationsByArea: Record<string, readonly string[]> = {
  usageRecoveryOperations: [
    'readAbandonedUsageCandidates',
    'releaseAbandonedUsage',
  ],
  billingOperations: [
    'billingSubscriptionStaleness',
    'billingEconomics',
    'billingMember',
    'billingCleanup',
    'billingRefunds',
    'billingPurchases',
    'billingPurchaseRecovery',
    'receiveBillingReceipt',
    'clubSeats',
    'clubSeatReads',
    'clubSeatReads.clubByHandle',
    'clubSeatReads.seating',
    'clubSeatReads.invitation',
    'clubSeatReads.seatOf',
    'billingSynchronization',
  ],
  botAdmissionOperations: ['readRoundBotAdmissionStatus'],
  roundMaintenanceOperations: [
    'readRoundMaintenanceCandidates',
    'tickDueRound',
    'finalizeDueRoundTranscript',
  ],
  roundPanelCompletionOperations: ['completePanelRound'],
  roundWorkerEntrypoints: [
    'scanRoundJudgingJobs',
    'claimRoundJudgingJob',
    'verifyRoundJudgingJob',
    'recordRoundJudgingAttemptFailure',
    'renewRoundJudgingJob',
    'beginRoundJudgingModelCall',
    'recordRoundJudgingUsage',
    'saveRoundJudgingResult',
    'saveRoundJudgingStage',
    'submitRoundJudgingResult',
    'beginRoundBotGeneration',
    'finishRoundBotGeneration',
    'scanRoundBotWorkers',
    'claimRoundBotWorker',
    'verifyRoundBotWorker',
    'renewRoundBotWorker',
    'revokeRoundBotWorker',
    'verifyRoundBotPublication',
    'beginRoundBotPhrase',
    'endRoundBotPhrase',
    'revealRoundBotPhrase',
    'readRoundBotPeerLine',
    'watchRoundBotFloor',
  ],
  roundAnalysisEntrypoints: [
    'requestRoundAnalysis',
    'scanRoundAnalysisJobs',
    'claimRoundAnalysisJob',
    'beginRoundAnalysisModelCall',
    'recordRoundAnalysisOutcome',
    'completeRoundAnalysisJob',
    'retryRoundAnalysisJob',
  ],
  roundAnalysisReads: ['readRoundAnalysis'],
  attendanceEntrypoints: [
    'withAttendanceDiscovery',
    'withAttendanceReceipt',
    'evaluateRoundAttendance',
    'reconcileRoundCheckInAttempts',
  ],
  availabilityOperations: [
    'renewServiceInstance',
    'availabilitySampler',
    'publicProbeResourceProblems',
    'readAvailabilitySamples',
    'purgeExpiredServiceInstances',
    'purgeExpiredAvailabilitySamples',
  ],
  databaseHealthOperations: [
    'health',
    'currentDatabaseName',
    'checkListen',
    'runtimeRoleProblems',
    'tenantIsolationProblems',
  ],
  authOperations: [
    'authAdapter',
    'completeEmailChange',
    'revokeSessionUnlessAddressHeld',
    'revokeOtherSessions',
    'purgeExpiredSessions',
    'purgeAllForRestore',
  ],
  provisionalRetentionOperations: ['purgeExpiredProvisionalUsers'],
  authorizationSessionOperations: [
    'resolveRealtimeSession',
    'readAuthorizationSession',
  ],
  emailDeliveryOperations: [
    'purgeExpiredVerifications',
    'purgeExpiredEmailDeliveryEvents',
    'purgeExpiredEmailDeliveries',
    'recordEmailDelivery',
    'isRecipientSuppressed',
    'applyEmailDeliveryEvent',
  ],
  mailIntentOperations: [
    'claimMailIntents',
    'readMailIntentDelivery',
    'settleMailIntent',
    'purgeLapsedClubSeatInvitations',
    'purgeExpiredMailIntents',
  ],
  leagueRequestOperations: [
    'leagueRequestUnchanged',
    'recordLeagueRequest',
    'claimLeagueRequestNotices',
    'readLeagueRequestNotice',
    'settleLeagueRequestNotice',
    'purgeExpiredLeagueRequests',
  ],
  mediaReleaseMailOperations: [
    'claimMediaReleaseMails',
    'prepareMediaReleaseMail',
    'settleMediaReleaseMail',
    'purgeEndedMediaReleaseRequests',
    'purgeWithdrawnMediaReleases',
  ],
  betaAccessOperations: ['getParticipationByUserId'],
  operatorAccountOperations: [
    'listOperatorAccounts',
    'betaAccessCommand',
    'readOperatorCommand',
  ],
  flagOperations: [
    'readFlagSnapshot',
    'flagCommand',
    'purgeExpiredFlagOverrides',
    'purgeExpiredFlagEvidence',
  ],
  preapprovalOperations: ['listBetaPreapprovals', 'preapprovalCommand'],
  contentModerationOperations: [
    'readReportTargetFacts',
    'fileReport',
    'listModerationReports',
    'readModerationReport',
    'recordingWithdrawalCommand',
    'chatRemovalCommand',
    'runModerationCommand',
    'listProfilePhotoReviews',
    'readOperatorProfilePhoto',
    'listRebuildableRecordings',
    'readChatPostFacts',
  ],
  actorOperations: [
    'lookupHumanActorByUsername',
    'getActiveHumanUserIdByActorId',
    'getActorByUserId',
  ],
  messagingOperations: [
    'purgeExpiredRoundFloorMessages',
    'purgeExpiredRoundFloorReceipts',
    'purgeExpiredRoundFloorReadStates',
    'roundFloorStore',
    'purgeExpiredRoomCommunityMessages',
    'purgeExpiredRoomCommunityReceipts',
    'purgeExpiredRoomCommunityReadStates',
    'roomCommunityStore',
    'messagingInboxPage',
    'messagingDmStore',
    'messagingChannelAuthority',
    'readMessagingPairFacts',
    'messagingFileMaintenance',
    'messagingFileMaintenance.run',
    'messagingFileCleanup',
    'messagingFileStore',
    'messagingTypingStore',
    'messagingTypingPrivacyPort',
    'messagingPreferenceStore',
    'messagingChannelStore',
    'messagingReactionStore',
    'messagingGroupCreationStore',
    'messagingGroupIssuanceStore',
    'messagingGroupManagementStore',
    'messagingGroupInvitationStore',
    'messagingSocialStore',
  ],
  friendshipReadOperations: ['listFriendships'],
  presenceSettingOperations: ['readChosenStatus', 'writeChosenStatus'],
  peopleListOperations: ['readPeopleListPage'],
  publicProfileOperations: [
    'readOwnPublicProfile',
    'writePublicProfileText',
    'reserveProfilePhoto',
    'recordProfilePhoto',
    'withdrawProfilePhotos',
    'readProfilePhoto',
    'readPublicProfileCards',
    'readPublicProfile',
    'duePhotoDeletions',
    'completePhotoDeletion',
    'deferPhotoDeletion',
    'owedPhotoDeletions',
  ],
  memberCardOperations: ['readMemberCards', 'readMemberCardRatings'],
  challengeReadOperations: [
    'listChallenges',
    'readChallengeCounterpart',
    'purgeExpiredChallenges',
  ],
  reportOperations: [
    'listOperatorReports',
    'resolveReport',
    'purgeClosedReports',
  ],
  moderationOperations: [
    'listOperatorRestrictions',
    'liftModeration',
    'readRestrictionEnd',
    'listModerationNotices',
    'acknowledgeModerationNotice',
    'purgeErasedModeration',
  ],
  retainedConversationOperations: [
    'listRetainedConversations',
    'readRetainedConversation',
    'deleteRetainedConversation',
  ],
  outboxOperations: [
    'purgeExpiredOutboxEvents',
    'drainOutbox',
    'readOutboxHighWaterMark',
  ],
  transcriptRetention: [
    'purgeExpiredUtterances',
    'clearExpiredPendingBallots',
    'clearExpiredJudgingStages',
  ],
  roundAnalysisRetention: ['purgeExpiredRoundAnalyses'],
  socialRequestRetention: [
    'purgeExpiredSocialDeclines',
    'purgeExpiredSocialRequests',
  ],
  formatOperations: [
    'getFormat',
    'getCurrentPreset',
    'getFormatSelectionFacts',
    'getFormatRevision',
  ],
  agreementSignatureOperations: [
    'readContentWaiverStanding',
    'signContentWaiver',
  ],
  memberDivisionOperations: ['readMemberDivision', 'readRoomCreatorFact'],
  roomCommandOperations: [
    'purgeExpiredRoomCommands',
    'purgeExpiredRoundCheckInAttempts',
    'purgeExpiredRoundCommands',
    'readLaunchedRound',
    'formatInCatalog',
    'listRoomCatalogSources',
    'readRoomAssembly',
    'readRoomAssemblyFacts',
    'listRoomPage',
    'listRoomBots',
    'readOwnCasualJudgeAllowance',
    'readOwnEntitlementGrants',
    'readRoomCreateReceipt',
    'readRoomAuthorizationFacts',
    'readRoundAuthorizationFacts',
    'readActiveRoomFacts',
    'listHostedRooms',
    'readMaintenanceCandidates',
    'maintainRoom',
    'publishResolutionBankRevision',
    'createRoomCommand',
    'readRoomInvitations',
    'inviteToRoom',
    'purgeEndedRoomInvitations',
    'endRoomInvitation',
    'executeRoomCommand',
  ],
  roundOperations: ['databaseNow', 'createRound', 'getRound'],
  roundCommandOperations: ['executeRoundTick', 'executeRoundCommand'],
  roundBallotOperations: [
    'listRoundJudgeAssignments',
    'readRoundBallot',
    'executeRoundBallot',
  ],
  roundProtectedReads: ['readRoundTranscript'],
  roundSpeakingRead: ['readRoundSpeakingEligibility'],
  utteranceOperations: ['listSegmentUtterances', 'listRoundUtterances'],
  transcriptFinalizationOperations: ['readFrozenRoundTranscript'],
  documentOperations: [
    'listDriveEntries',
    'listDocumentFolders',
    'readDocuments',
    'recentDocuments',
    'searchDocuments',
    'createDocument',
    'saveDocument',
    'renameDocument',
    'moveDocument',
    'deleteDocument',
    'createDocumentFolder',
    'renameDocumentFolder',
    'moveDocumentFolder',
    'countFolderDocuments',
    'deleteDocumentFolder',
  ],
  analyticsConsentOperations: ['readAnalyticsConsent', 'saveAnalyticsConsent'],
  onboardingOperations: [
    'saveOnboardingStep',
    'completeOnboarding',
    'optionalAnswersAdmitted',
    'readOnboarding',
  ],
  ageStepOperations: [
    'recordAgeStep',
    'childAccountBinding',
    'hasRecordedAge',
    'deleteProvisionalUser',
  ],
  standingsOperations: [
    'readRatingBlindings',
    'listLadderSeasons',
    'listOfficialRatingLadders',
    'listRankedFormats',
    'readStandings',
  ],
  memberProfileReadOperations: ['readMemberProfile'],
  spectatorTimelineReads: ['readSpectatorTimeline'],
  liveBroadcastReads: ['listLiveBroadcasts', 'countLiveBroadcasts'],
  watchableRoundOfRoomRead: ['readWatchableRoundOfRoom'],
  audienceSnapshotReads: [
    'readAudienceSnapshot',
    'readLiveRoomStanding',
    'readOnAirAudience',
  ],
  spectatorChatOperations: [
    'postSpectatorChatMessage',
    'readSpectatorChat',
    'purgeExpiredSpectatorChat',
  ],
  audienceReactionOperations: [
    'recordAudienceReaction',
    'purgeExpiredAudienceReactions',
  ],
  debaterFollowOperations: [
    'setDebaterFollow',
    'readDebaterFollow',
    'listFollowedDebaters',
  ],
  watchHistoryOperations: [
    'recordWatched',
    'forgetWatched',
    'clearWatchHistory',
    'listWatchHistory',
    'purgeExpiredWatchHistory',
  ],
  notificationOperations: [
    'sweepNotificationFanouts',
    'readNotifications',
    'markNotificationsRead',
    'purgeReadNotifications',
    'readNotificationPreferences',
    'writeNotificationPreferences',
    'readNotificationPresentation',
    'writeNotificationPresentation',
    'stopNotificationEmail',
    'claimNotificationDigests',
    'readNotificationDigestDelivery',
    'settleNotificationDigest',
    'postponeNotificationDigest',
    'purgeExpiredNotificationDigests',
  ],
  messageRequestSettingOperations: [
    'readMessageRequestSetting',
    'readMessageRequestPolicy',
    'writeMessageRequestSetting',
  ],
  messagingUnreadEmailOperations: [
    'claimMessagingUnreadEmails',
    'readMessagingUnreadEmailDelivery',
    'settleMessagingUnreadEmail',
    'postponeMessagingUnreadEmail',
    'purgeExpiredMessagingUnreadEmails',
  ],
  recordingRoundReadOperations: [
    'readRecordingRound',
    'readRecordingBroadcastRelease',
    'readRecordingTranscript',
    'readRecordingBallots',
    'readRecordingCoverageFacts',
    'readRecordingFloorIntervals',
  ],
  youthLiveReadOperations: [
    'readRoundYouth',
    'readYouthRoundPeople',
    'readStudentLiveRounds',
    'readRoundReuseFenced',
  ],
  roundAudienceLinkOperations: [
    'readRoundAudienceLink',
    'readHostedRoundAudienceLink',
    'setRoundAudienceLink',
  ],
  recordingArchiveReadOperations: [
    'listRecordingArchive',
    'countPublicRecordingArchive',
  ],
  spectatorFactLogOperations: ['sweepSpectatorFactLog'],
  recordingOperations: [
    'requestRecording',
    'findRecording',
    'findRecordingByRound',
    'applyRecording',
    'applyParticipantRemoval',
    'claimRecordingDeletions',
    'deferRecordingDeletion',
    'listEndedRecordingEvidenceHolds',
    'listFailedRecordingsBefore',
  ],
  createMediaReleases: [
    'mediaReleases',
    'mediaReleases.readGuardianRelease',
    'mediaReleases.signAsGuardian',
    'mediaReleases.readMinorRelease',
    'mediaReleases.ask',
    'mediaReleases.resend',
    'mediaReleases.cancel',
    'mediaReleases.readParentLink',
    'mediaReleases.sign',
    'mediaReleases.answer',
    'mediaReleases.withdraw',
    'mediaReleases.changePaidAds',
    'mediaReleases.mailManageLink',
    'mediaReleases.stopRequests',
  ],
  createMediaReleaseClubs: [
    'mediaReleaseClubs',
    'mediaReleaseClubs.readClubReleases',
    'mediaReleaseClubs.countClubReleasesNeeded',
    'mediaReleaseClubs.confirmClubReleases',
    'mediaReleaseClubs.askClub',
  ],
  createRoundIncidentStore: [
    'roundIncidents',
    'roundIncidents.readRoundIncidentWatch',
    'roundIncidents.observeRoundIncident',
  ],
  createRoundStartGateStore: [
    'roundStartGates',
    'roundStartGates.readRoundStartGate',
    'roundStartGates.moveRoundStartGate',
  ],
  createBroadcastStore: [
    'broadcasts',
    'broadcasts.discoverUnopened',
    'broadcasts.open',
    'broadcasts.listOpen',
    'broadcasts.readEgress',
    'broadcasts.conversationHeld',
    'broadcasts.claimReconcile',
    'broadcasts.holdReconcile',
    'broadcasts.readStage',
    'broadcasts.readRound',
    'broadcasts.beginEgressAttempt',
    'broadcasts.settleEgressAttempt',
    'broadcasts.recordEgressStarted',
    'broadcasts.recordObserverRevoked',
    'broadcasts.recordRevocationFailed',
    'broadcasts.recordObserverRestored',
    'broadcasts.recordFinalMediaEnd',
    'broadcasts.complete',
  ],
  createRecordingCaptureStore: [
    'recordingCaptures',
    'recordingCaptures.listExpiredTournamentAdmissions',
    'recordingCaptures.settleUndispatchedTournamentAdmission',
    'recordingCaptures.discoverUnrecorded',
    'recordingCaptures.readAccountGrants',
    'recordingCaptures.listOpen',
    'recordingCaptures.readRound',
    'recordingCaptures.openOwn',
    'recordingCaptures.claimOwn',
    'recordingCaptures.holdOwn',
    'recordingCaptures.readOwnEgress',
    'recordingCaptures.beginOwnEgressAttempt',
    'recordingCaptures.settleOwnEgressAttempt',
    'recordingCaptures.recordOwnEgressStarted',
    'recordingCaptures.recordOwnRevoked',
    'recordingCaptures.recordOwnRevocationFailed',
    'recordingCaptures.recordOwnRestored',
    'recordingCaptures.closeOwn',
    'recordingCaptures.readStage',
    'recordingCaptures.openJob',
    'recordingCaptures.readPublicHistory',
    'recordingCaptures.queueJob',
    'recordingCaptures.stripSources',
    'recordingCaptures.discardSources',
    'recordingCaptures.sourcesRemain',
    'recordingCaptures.listJobs',
    'recordingCaptures.listProcessingUnalerted',
    'recordingCaptures.markDelayAlerted',
    'recordingCaptures.readJobState',
  ],
  createMediaSessionStore: [
    'mediaSessions',
    'mediaSessions.requestMediaReconcile',
    'mediaSessions.claimMediaReconcile',
    'mediaSessions.mediaReconcileProgress',
    'mediaSessions.activeMediaSessions',
    'mediaSessions.beginMediaMutation',
    'mediaSessions.settleMediaMutation',
    'mediaSessions.markMediaUnsafe',
    'mediaSessions.prepareMediaAbsenceProof',
    'mediaSessions.finishMediaReconcile',
    'mediaSessions.issueMediaToken',
    'mediaSessions.readMediaSession',
    'mediaSessions.ensureBinding',
    'mediaSessions.ensureBotBinding',
    'mediaSessions.findBinding',
  ],
  'rating-discovery': ['readRatingCandidates', 'readRatingFacts'],
  listen: ['listenOutbox'],
  'realtime-hints': ['listenRealtimeHints'],
  'work-wake': ['listenWorkWakes'],
  workload: ['laneGauges', 'drainLaneHolds', 'close'],
  'observation-purge-jobs': [
    'deliverObservationPurges',
    'owedObservationPurges',
  ],
  'privacy/vendor-jobs': [
    'owedPrivacyJobs',
    'duePrivacyJobs',
    'deliverPrivacyJob',
  ],
  'privacy/subject-rights': [
    'erasePrivacySubject',
    'eraseGuardianChild',
    'exportPrivacySubject',
  ],
  createTabStore: [
    'tabCommands',
    'tabCommands.participantEventResults',
    'tabCommands.publicTournamentPosting',
    'tabCommands.tournamentDirectory',
    'tabCommands.participantTournament',
    'tabCommands.sanctionCommand',
    'tabCommands.leagueSeason',
    'tabCommands.hostedLeagueCandidates',
    'tabCommands.standingLobbyManagement',
    'tabCommands.leagueSchoolCommand',
    'tabCommands.resultCommand',
    'tabCommands.fixtureCommand',
    'tabCommands.confirmationCommand',
    'tabCommands.conflictWaiverRequest',
    'tabCommands.releaseCommand',
    'tabCommands.tournamentSponsorshipCommand',
    'tabCommands.hostedTournaments',
    'tabCommands.tournamentHosting',
    'tabCommands.tournamentHostingSettlement',
    'tabCommands.drawCommand',
    'tabCommands.eventCompetition',
    'tabCommands.completionCommand',
    'tabCommands.hostNavigation',
    'tabCommands.lobbyPeople',
    'tabCommands.hostBallots',
    'tabCommands.hostResults',
    'tabCommands.hostDrawOverview',
    'tabCommands.hostRound',
    'tabCommands.hostEvents',
    'tabCommands.leagueRatings',
    'tabCommands.hostRoster',
    'tabCommands.lobbyAdministrationCommand',
    'tabCommands.settingCommand',
    'tabCommands.setupCommand',
    'tabCommands.judgeRegistrationCommand',
    'tabCommands.entryEnrollmentCommand',
    'tabCommands.standingRoomDraft',
    'tabCommands.createLobbyRoom',
    'tabCommands.tournamentSetup',
    'tabCommands.tournamentEventSettings',
    'tabCommands.eventBallot',
    'tabCommands.organizationCommand',
    'tabCommands.organizationPeople',
    'tabCommands.standingLobbyAddressOfHandle',
    'tabCommands.lobbyIdOfHandle',
    'tabCommands.organizationIdOfHandle',
  ],
  createGuardianStore: ['guardians', 'guardians.forSubject'],
  createLobbyPermissionStore: [
    'lobbyPermissions',
    'lobbyPermissions.read',
    'lobbyPermissions.apply',
  ],
  'guardians/retention': ['expireGuardianRequests'],
  createChallengeStore: ['challengeStore'],
  createReportStore: ['reportStore'],
  createFriendStore: ['friendStore'],
  createContactStore: ['contactStore'],
  'outbox-retention-boundary': ['readOutboxRetentionBoundary'],
  'outbox-catchup': ['readOutboxCatchup'],
  TranscriptionRecovery: ['createTranscriptionRecovery'],
  NecessaryEvidenceRetirement: ['createNecessaryEvidenceRetirement'],
  mediaCaptureOperations: ['createMediaCaptureOperations'],
  'guardians/lobby-permissions': [
    'readGuardianLobbyIds',
    'hasGuardianLobbyWaiver',
  ],
  'official-standing-lobbies': ['readOfficialStandingLobbies'],
  'challenges/lobby': ['readProfileChallengeModes'],
  'ladder-division-band': ['readCompetitionAgeBand'],
  'rating-operations': ['rateRound'],
  'username-claim': ['claimUsername'],
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  Object.getPrototypeOf(value) === Object.prototype;

/** Each top-level name, and each member of a plain-object store under it. */
const operationNames = (surface: Record<string, unknown>) =>
  Object.entries(surface).flatMap(([name, value]) => [
    name,
    ...(isPlainObject(value)
      ? Object.keys(value).map((member) => `${name}.${member}`)
      : []),
  ]);

describe('database operation inventory (R4.5 net)', () => {
  test('exposes exactly the inventoried operations', async () => {
    const { database } = unreachableDatabase();
    try {
      assert({
        given: 'the composed database',
        should: 'expose every inventoried operation and nothing else',
        actual: operationNames(database).sort(),
        expected: Object.values(operationsByArea).flat().sort(),
      });
    } finally {
      await database.close();
    }
  });

  test('every operation comes from exactly one area store', async () => {
    const resources = openDatabaseResources({
      url: 'postgresql://user:password@127.0.0.1:1/daisy',
      waits: virtualClock(),
    });
    const nextId = createId;
    const stores: Record<string, object> = {
      resources: {
        laneGauges: resources.laneGauges,
        drainLaneHolds: resources.drainLaneHolds,
        close: resources.close,
      },
      ageStep: createAgeStepStore(resources),
      agreements: createAgreementsStore(resources),
      analyticsConsent: createAnalyticsConsentStore(resources),
      attendance: createAttendanceStore(resources, { nextId }),
      audienceReactions: createAudienceReactionsStore(resources),
      auth: createAuthStore(resources),
      availability: createAvailabilityStore(resources),
      betaAccess: createBetaAccessStore(resources),
      billing: createBillingStore(resources, { nextId }),
      broadcasts: createBroadcastStore(resources),
      challenges: createChallengesStore(resources),
      contacts: createContactsStore(resources, { reactions: contactReactions }),
      contentModeration: createContentModerationStore(
        resources,
        contentModerationPorts,
      ),
      debaterFollows: createDebaterFollowsStore(resources),
      documents: createDocumentStore(resources),
      flags: createFlagsStore(resources),
      formats: createFormatsStore(resources),
      friends: createFriendsStore(resources, { reactions: contactReactions }),
      guardians: createGuardiansStore(resources),
      health: createHealthStore(resources),
      leagueRequests: createLeagueRequestsStore(resources),
      listen: createListenStore(resources),
      lobbies: createLobbyStore(resources),
      mail: createMailStore(resources),
      mediaCapture: createMediaCaptureStore(resources),
      mediaReleases: createMediaReleaseStore(resources, { nextId }),
      mediaSessions: createMediaSessionStore(resources, { nextId }),
      memberDivision: createMemberDivisionStore(resources),
      messaging: createMessagingStore(resources, {
        reactions: contactReactions,
      }),
      moderation: createModerationStore(resources),
      notifications: createNotificationsStore(resources),
      onboarding: createOnboardingStore(resources, { nextId }),
      operatorAccounts: createOperatorAccountsStore(resources),
      outbox: createOutboxStore(resources),
      presence: createPresenceStore(resources),
      privacy: createPrivacyStore(resources),
      profiles: createProfileStore(resources),
      ratings: createRatingStore(resources),
      recordings: createRecordingStore(resources),
      reports: createReportsStore(resources, {
        reactions: moderationReactions,
      }),
      rooms: createRoomStore(resources, { nextId }),
      roundAnalysis: createRoundAnalysisStore(resources, { nextId }),
      roundBallots: createRoundBallotStore(resources),
      roundBotAdmission: createRoundBotAdmissionStore(resources, { nextId }),
      roundIncidents: createRoundIncidentStore(resources),
      roundMaintenance: createRoundMaintenanceStore(resources),
      rounds: createRoundStore(resources),
      roundStartGates: createRoundStartGateStore(resources),
      roundWorkers: createRoundWorkerStore(resources, { nextId }),
      spectating: createSpectatingStore(resources),
      spectatorChat: createSpectatorChatStore(resources),
      standings: createStandingsStore(resources),
      tab: createTabCommandStore(resources),
      transcripts: createTranscriptStore(resources),
      watchHistory: createWatchHistoryStore(resources),
    };
    try {
      const provided = Object.entries(stores).flatMap(([store, surface]) =>
        operationNames(surface as Record<string, unknown>).map((name) => ({
          store,
          name,
        })),
      );
      const names = provided.map(({ name }) => name);
      assert({
        given: 'every area store composed over one set of resources',
        should:
          'provide every inventoried operation, each from one store, and nothing else',
        actual: {
          names: [...new Set(names)].sort(),
          twice: provided.filter(
            ({ name }, index) => names.indexOf(name) !== index,
          ),
        },
        expected: {
          names: Object.values(operationsByArea).flat().sort(),
          twice: [],
        },
      });
    } finally {
      await resources.close();
    }
  });

  test('names each operation in exactly one area', () => {
    const names = Object.values(operationsByArea).flat();
    assert({
      given: 'the inventory',
      should: 'list no operation twice',
      actual: names.filter((name, index) => names.indexOf(name) !== index),
      expected: [],
    });
  });
});
