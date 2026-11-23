import type { Waits } from '@daisy/clock';
import type { DecisionReleasePolicy } from '@daisy/protocol/round-decision-release';
import {
  openDatabaseResources,
  type DatabaseEventSink,
  type WorkloadProfile,
} from '@daisy/db/resources';
import { createAgeStepStore } from '@daisy/db/stores/age-step';
import { createAgreementsStore } from '@daisy/db/stores/agreements';
import { createAnalyticsConsentStore } from '@daisy/db/stores/analytics-consent';
import { createAttendanceStore } from '@daisy/db/stores/attendance';
import { createAudienceReactionsStore } from '@daisy/db/stores/audience-reactions';
import { createAuthStore } from '@daisy/db/stores/auth';
import { createAvailabilityStore } from '@daisy/db/stores/availability';
import { createBetaAccessStore } from '@daisy/db/stores/beta-access';
import { createBillingStore } from '@daisy/db/stores/billing';
import { createBroadcastStore } from '@daisy/db/stores/broadcasts';
import { createChallengesStore } from '@daisy/db/stores/challenges';
import {
  contactReactions,
  createContactsStore,
} from '@daisy/db/stores/contacts';
import {
  contentModerationPorts,
  createContentModerationStore,
} from '@daisy/db/stores/content-moderation';
import { createDebaterFollowsStore } from '@daisy/db/stores/debater-follows';
import { createDocumentStore } from '@daisy/db/stores/documents';
import { createFlagsStore } from '@daisy/db/stores/flags';
import { createFormatsStore } from '@daisy/db/stores/formats';
import { createFriendsStore } from '@daisy/db/stores/friends';
import { createGuardiansStore } from '@daisy/db/stores/guardians';
import { createHealthStore } from '@daisy/db/stores/health';
import { createLeagueRequestsStore } from '@daisy/db/stores/league-requests';
import { createListenStore } from '@daisy/db/stores/listen';
import { createLobbyStore } from '@daisy/db/stores/lobbies';
import { createMailStore } from '@daisy/db/stores/mail';
import { createMediaCaptureStore } from '@daisy/db/stores/media-capture';
import { createMediaReleaseStore } from '@daisy/db/stores/media-releases';
import { createMediaSessionStore } from '@daisy/db/stores/media-sessions';
import { createMemberDivisionStore } from '@daisy/db/stores/member-division';
import { createMessagingStore } from '@daisy/db/stores/messaging';
import { createModerationStore } from '@daisy/db/stores/moderation';
import { createNotificationsStore } from '@daisy/db/stores/notifications';
import { createOnboardingStore } from '@daisy/db/stores/onboarding';
import { createOperatorAccountsStore } from '@daisy/db/stores/operator-accounts';
import { createOutboxStore } from '@daisy/db/stores/outbox';
import { createPresenceStore } from '@daisy/db/stores/presence';
import { createPrivacyStore } from '@daisy/db/stores/privacy';
import { createProfileStore } from '@daisy/db/stores/profiles';
import { createRatingStore } from '@daisy/db/stores/ratings';
import { createRecordingStore } from '@daisy/db/stores/recordings';
import {
  createReportsStore,
  moderationReactions,
} from '@daisy/db/stores/reports';
import { createRoomStore } from '@daisy/db/stores/rooms';
import { createRoundAnalysisStore } from '@daisy/db/stores/round-analysis';
import { createRoundBotAdmissionStore } from '@daisy/db/stores/round-bot-admission';
import { createRoundIncidentStore } from '@daisy/db/stores/round-incidents';
import { createRoundMaintenanceStore } from '@daisy/db/stores/round-maintenance';
import { createRoundStartGateStore } from '@daisy/db/stores/round-start-gates';
import { createRoundWorkerStore } from '@daisy/db/stores/round-workers';
import {
  createRoundBallotStore,
  createRoundStore,
} from '@daisy/db/stores/rounds';
import { createSpectatingStore } from '@daisy/db/stores/spectating';
import { createSpectatorChatStore } from '@daisy/db/stores/spectator-chat';
import { createStandingsStore } from '@daisy/db/stores/standings';
import { createTabCommandStore } from '@daisy/db/stores/tab';
import { createTranscriptStore } from '@daisy/db/stores/transcripts';
import { createWatchHistoryStore } from '@daisy/db/stores/watch-history';
import type { SQL } from 'bun';

type Options<Factory extends (...args: never[]) => unknown> = NonNullable<
  Parameters<Factory>[1]
>;

/** What the web process's database is opened with: its connection and each store's policy. */
export type WebDatabaseOptions = {
  readonly url: string;
  /** The process's time: every lane wait, transaction budget and connection bound (R4.7). */
  readonly waits: Waits;
  /** Required capability for completing a Round; absence refuses atomically, never defaults. */
  readonly decisionRelease?: DecisionReleasePolicy | undefined;
  /** Trusted Round persistence time resource; absent in production composition. */
  readonly roundTime?: Options<typeof createRoundStore>['roundTime'];
  /** The process's lane reservations; web unless a caller asks for another. */
  readonly profile?: WorkloadProfile | undefined;
  /** No implicit bot capacity or quota: absence truthfully refuses bot-debater admission. */
  readonly botAdmission?: Options<typeof createRoomStore>['botAdmission'];
  /** Shared account allowance; bot, judge and analysis capacity stay feature-owned. */
  readonly aiAllowance?: Options<typeof createRoomStore>['aiAllowance'];
  readonly judging?: Options<typeof createRoundWorkerStore>['judging'];
  readonly botPublication?: Options<
    typeof createRoundWorkerStore
  >['botPublication'];
  /** Round analysis's own jobs (DEC-247); absent, none run. */
  readonly roundAnalysis?: Options<
    typeof createRoundAnalysisStore
  >['roundAnalysis'];
  readonly eventSink?: DatabaseEventSink | undefined;
  /** Overrides dialing `url` for every lane; tests inject a scripted client at this seam. */
  readonly client?: SQL | undefined;
  /** The current request's fairness key (its client network). */
  readonly fairnessKey?: (() => string | undefined) | undefined;
  /** Required cuid2 source for onboarding actors and durable Round usage IDs. */
  readonly nextActorId: () => string;
};

/**
 * The web process's database (ADR 0088, ADR 0918): the process opens its
 * resources once and composes over them every area store its routes,
 * workers and sweeps read, each with the policy this process owns. A
 * feature never receives this whole object by type; it names the stores it
 * reads (`Pick<RoundStore, ...>`).
 */
export function openWebDatabase({
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
}: WebDatabaseOptions) {
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

export type WebDatabase = ReturnType<typeof openWebDatabase>;
