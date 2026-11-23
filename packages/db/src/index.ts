import type { SQL } from 'bun';
import { openDatabaseResources } from './resources';
import type { BotAdmissionOptions } from './round-bot-admission-entrypoints';
import type {
  JudgingOptions,
  BotPublicationOptions,
} from './round-worker-entrypoints';
import type { RoundAnalysisOptions } from './round-analysis-entrypoints';
import type { AiAllowanceOptions } from './usage-ledger';
import type { DatabaseEventSink } from './instrumented';
import type { WorkloadProfile } from './workload';
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
import type { DecisionReleasePolicy } from '@daisy/protocol/round-decision-release';
import type { RoundTimeSource } from './round-execution-time';
import type { Waits } from '@daisy/clock';
export type { RoundTimeSource } from './round-execution-time';
export type { RoundRoomAuthority } from './round-room-authority';
export type { RoundHydration } from './round-hydration';
export type {
  ClubSeatAnswer,
  ClubInvitationResendFacts,
  ClubSeatManagerCommand,
} from './club-seat-commands';
export type { ClubSeatingRead, ClubPerson } from './club-seat-reads';
export type {
  MinorReleaseRead,
  ParentLinkRead,
  ParentAnswer,
} from './media-releases';
export type {
  ClubReleasesRead,
  ClubReleaseStudent,
  ClubConfirmAnswer,
} from './media-release-club';
export type {
  MediaReleaseMailClaim,
  MediaReleaseMailKind,
  MediaReleaseMailOutcome,
  PreparedReleaseMail,
} from './media-release-mail';
export type { ContentWaiverStanding } from './agreement-signatures';
export type {
  MessagingUnreadEmailDelivery,
  MessagingUnreadEmailOutcome,
} from './messaging/unread-emails';
export type {
  InboxCursor,
  InboxRow,
  NotificationDigestDelivery,
  NotificationDigestOutcome,
} from './notifications';
export type {
  OwnPublicProfile,
  PhotoDeletion,
  PublicProfileCard,
  StoredProfilePhoto,
} from './public-profile-operations';
export type { SpectatorTimelineRead } from './spectator-timeline-reads';
export type { LiveBroadcastPage } from './live-broadcast-reads';
export type { GuardianLinkRow, GuardianSession } from './guardians/store';
export {
  WORKLOAD_PROFILES,
  type WorkloadLane,
  type WorkloadProfile,
} from './workload';
export type { DatabaseEventSink } from './instrumented';
export type { RestrictionRules } from './moderation/store';
export type { SocialRequestLimits } from './contacts/request-budget';
export type {
  ProvisionalLinkPurposes,
  ProvisionalMailCleanup,
} from './provisional-cleanup';
export { refuseSchemaAlteringRole } from './runtime-role';
export type { WorkKind } from './work-wake';
export { refuseUnisolatedTenantTables } from './tenant-isolation';
export {
  createRealtimeDatabase,
  type RealtimeAuthorityReads,
  type RealtimeDatabase,
} from './realtime-database';
export type { ChannelObservationReads } from './messaging/observation-reads';

/**
 * The whole web process's database, composed from every area's store over
 * one set of opened resources (ADR 0088). It remains only until each process
 * composes the stores it uses (R4.5); every member is an area store's.
 */
export function createDatabase({
  url,
  profile,
  eventSink,
  client,
  fairnessKey,
  nextActorId: nextId,
  botAdmission,
  aiAllowance,
  judging,
  botPublication,
  roundAnalysis,
  roundTime,
  decisionRelease,
  waits,
}: {
  url: string;
  /** The process's time: every lane wait, transaction budget and connection bound (R4.7). */
  waits: Waits;
  /** Required capability for completing a Round; absence refuses atomically, never defaults. */
  decisionRelease?: DecisionReleasePolicy;
  /** Trusted Round persistence time resource; absent in production composition. */
  roundTime?: RoundTimeSource;
  /** The process's lane reservations; web unless a caller asks for another. */
  profile?: WorkloadProfile;
  /** No implicit bot capacity or quota: absence truthfully refuses bot-debater admission. */
  botAdmission?: BotAdmissionOptions | undefined;
  /** Shared account allowance; bot, judge and analysis capacity stay feature-owned. */
  aiAllowance?: AiAllowanceOptions | undefined;
  judging?: JudgingOptions | undefined;
  botPublication?: BotPublicationOptions | undefined;
  /** Round analysis's own jobs (DEC-247); absent, none run. */
  roundAnalysis?: RoundAnalysisOptions | undefined;
  eventSink?: DatabaseEventSink;
  /** Overrides dialing `url` for every lane; tests inject a scripted client at this seam. */
  client?: SQL;
  /** The current request's fairness key (its client network). */
  fairnessKey?: () => string | undefined;
  /** Required cuid2 source for onboarding actors and durable Round usage IDs. */
  nextActorId: () => string;
}) {
  const resources = openDatabaseResources({
    url,
    profile,
    waits,
    eventSink,
    client,
    fairnessKey,
  });
  const admission = { nextId, botAdmission, aiAllowance };
  const round = { roundTime, decisionRelease };
  return {
    laneGauges: resources.laneGauges,
    drainLaneHolds: resources.drainLaneHolds,
    close: resources.close,
    ...createBillingStore(resources, { nextId }),
    ...createMediaReleaseStore(resources, { nextId }),
    ...createRoundBotAdmissionStore(resources, admission),
    ...createRoundMaintenanceStore(resources, round),
    ...createRoundWorkerStore(resources, {
      nextId,
      decisionRelease,
      judging,
      botPublication,
    }),
    ...createRoundAnalysisStore(resources, {
      nextId,
      roundAnalysis,
      aiAllowance,
    }),
    ...createRoundIncidentStore(resources, { decisionRelease }),
    ...createRoundStartGateStore(resources, { decisionRelease }),
    ...createBroadcastStore(resources),
    ...createMediaSessionStore(resources, { nextId, decisionRelease }),
    ...createAttendanceStore(resources, { nextId, ...round }),
    ...createAvailabilityStore(resources),
    ...createRatingStore(resources),
    ...createHealthStore(resources),
    ...createListenStore(resources),
    ...createPrivacyStore(resources),
    ...createAuthStore(resources),
    ...createMailStore(resources),
    ...createLeagueRequestsStore(resources),
    ...createBetaAccessStore(resources),
    ...createOperatorAccountsStore(resources),
    ...createFlagsStore(resources),
    ...createContentModerationStore(resources, contentModerationPorts),
    ...createOnboardingStore(resources, { nextId }),
    ...createMessagingStore(resources, { reactions: contactReactions }),
    ...createTabCommandStore(resources),
    ...createGuardiansStore(resources),
    ...createFriendsStore(resources, { reactions: contactReactions }),
    ...createPresenceStore(resources),
    ...createProfileStore(resources),
    ...createChallengesStore(resources),
    ...createReportsStore(resources, {
      reactions: moderationReactions,
      decisionRelease,
    }),
    ...createModerationStore(resources),
    ...createContactsStore(resources, { reactions: contactReactions }),
    ...createOutboxStore(resources),
    ...createTranscriptStore(resources),
    ...createFormatsStore(resources),
    ...createAgreementsStore(resources),
    ...createMemberDivisionStore(resources),
    ...createRoomStore(resources, admission),
    ...createRoundStore(resources, round),
    ...createRoundBallotStore(resources, round),
    ...createMediaCaptureStore(resources, { decisionRelease }),
    ...createDocumentStore(resources),
    ...createAnalyticsConsentStore(resources),
    ...createAgeStepStore(resources),
    ...createStandingsStore(resources),
    ...createSpectatingStore(resources),
    ...createLobbyStore(resources),
    ...createSpectatorChatStore(resources),
    ...createAudienceReactionsStore(resources),
    ...createDebaterFollowsStore(resources),
    ...createWatchHistoryStore(resources),
    ...createNotificationsStore(resources),
    ...createRecordingStore(resources),
  };
}
export type Database = ReturnType<typeof createDatabase>;
export type { LeagueRequestNotice } from './league-requests';

export type { RoundBallotAccess } from '@daisy/protocol/ballot-audience';
