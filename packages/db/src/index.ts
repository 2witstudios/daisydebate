import { messagingOperations } from './messaging/operations';
import { friendshipReadOperations } from './friends/reads';
import { createFriendStore } from './friends/store';
import { createContactStore } from './contacts/store';
import { contactReactions } from './contact-composition';
import { presenceSettingOperations } from './presence/settings';
import type { ContactAuthorizationFence } from './contacts/fence';
import { retainedConversationOperations } from './messaging/retained-store';
import { createMediaSessionStore } from './media-session';
import { roundUnjudgedCompletionOperations } from './round-unjudged-completion';
import { roundMaintenanceOperations } from './round-maintenance';
import {
  roundWorkerEntrypoints,
  type JudgingOptions,
  type BotPublicationOptions,
} from './round-worker-entrypoints';
import {
  roundAnalysisEntrypoints,
  type RoundAnalysisOptions,
} from './round-analysis-entrypoints';
import { roundAnalysisReads } from './round-analysis-reads';
import { roundAnalysisRetention } from './round-analysis-retention';
import { attendanceEntrypoints } from './attendance-entrypoints';
import { availabilityOperations } from './availability-operations';
import { databaseHealthOperations } from './database-health';
import { roundBallotOperations } from './round-ballot-operations';
import {
  roundBotAdmissionEntrypoints,
  type BotAdmissionOptions,
} from './round-bot-admission-entrypoints';
import { mediaCaptureOperations } from './media-capture';
import { roundSpeakingRead } from './round-speaking-read';
import { createBoundedTransaction } from './bounded-transaction';
import { readUnratedRatingRounds } from './rating-discovery';
import { deliverObservationPurges } from './observation-purge-jobs';
import { roundProtectedReads } from './round-protected-reads';
import type { SQL } from 'bun';
import { subscribeOutbox, type OutboxListenHandlers } from './listen';
import {
  subscribeRealtimeHints,
  type RealtimeHintHandlers,
} from './realtime-hints';
import { claimUsername } from './username-claim';
import { mailIntentOperations } from './mail-intents';
import { betaAccessOperations } from './beta-access';
import { operatorAccountOperations } from './operator-accounts';
import { provisionalRetentionOperations } from './provisional-retention';
import { authOperations } from './auth-operations';
import { authorizationSessionOperations } from './authorization-session';
import { formatOperations } from './format-operations';
import { roomCommandOperations } from './room-command-operations';
import { roomCommandTransaction } from './room-command-transaction';
import { roundCommandOperations } from './round-command-operations';
import { roundOperations } from './round-operations';
import { transcriptFinalizationOperations } from './transcript-finalization';
import { utteranceOperations } from './utterance-operations';
import { documentOperations } from './document-operations';
import { onboardingOperations } from './onboarding-operations';
import { ageStepOperations } from './age-step';
import { actorOperations } from './actor-operations';
import { rateCompletedRound } from './rating-operations';
import { standingsOperations } from './standings';
import { memberProfileReadOperations } from './member-profile-reads';
import type { RateDebateInput } from './rating-facts';
import { emailDeliveryOperations } from './email-delivery-operations';
import { outboxOperations } from './outbox';
import { transcriptRetention } from './transcript-retention';
import { socialRequestRetention } from './contacts/request-budget';
import { readOutboxCatchup } from './outbox-catchup';
import { readOutboxRetentionBoundary } from './outbox-retention-boundary';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { createWorkload, dialDedicated, dialLanes } from './workload';
import { WORKLOAD_PROFILES, type WorkloadProfile } from './workload-admission';
export {
  WORKLOAD_PROFILES,
  type WorkloadLane,
  type WorkloadProfile,
} from './workload-admission';
export type { DatabaseEventSink } from './instrumented';
export type { SocialRequestLimits } from './contacts/request-budget';
export type {
  ProvisionalLinkPurposes,
  ProvisionalMailCleanup,
} from './provisional-cleanup';
export { refuseSchemaAlteringRole } from './runtime-role';
export {
  createRealtimeDatabase,
  type RealtimeAuthorityReads,
  type RealtimeDatabase,
} from './realtime-database';
export type { ChannelObservationReads } from './messaging/observation-reads';

/**
 * Composes every area over one admission owner (ADR 0088): each area
 * receives the opaque Drizzle handle of the lane its work belongs to and
 * the event sink, never a raw client, and returns records, not rows.
 * Competitive work (Rounds, Rooms, media, judging, bots) has its own lane;
 * social, audience and control traffic cannot take its connections. The
 * competitive kernel persists what the caller's domain decisions resolve —
 * the composition root (the app) injects the engine.
 */
export function createDatabase({
  url,
  profile = WORKLOAD_PROFILES.web,
  eventSink,
  client: injectedClient,
  fairnessKey,
  nextActorId,
  botAdmission,
  judging,
  botPublication,
  roundAnalysis,
}: {
  url: string;
  /** The process's lane reservations; web unless a caller asks for another. */
  profile?: WorkloadProfile;
  /** No implicit bot capacity or quota: absence truthfully refuses bot-debater admission. */
  botAdmission?: BotAdmissionOptions | undefined;
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
  const workload = createWorkload({
    profile,
    connect: injectedClient ? () => injectedClient : dialLanes(url),
    fairnessKey,
  });
  const competitive = workload.lane('competitive');
  const { database } = competitive;
  const social = workload.lane('social').database;
  const audience = workload.lane('audience').database;
  const controlLane = workload.lane('control');
  const control = controlLane.database;
  const dedicated =
    injectedClient ?? dialDedicated(url, Math.max(1, profile.dedicated));
  const transcriptTransaction = createBoundedTransaction({
    lane: competitive,
    now: performance.now,
  });
  const { admission, operations: botAdmissionOperations } =
    roundBotAdmissionEntrypoints({
      run: transcriptTransaction,
      nextId: nextActorId,
      botAdmission,
    });
  return {
    ...botAdmissionOperations,
    ...roundMaintenanceOperations(transcriptTransaction),
    ...roundUnjudgedCompletionOperations(transcriptTransaction),
    ...roundWorkerEntrypoints({
      run: transcriptTransaction,
      nextId: nextActorId,
      judging,
      botPublication,
    }),
    ...roundAnalysisEntrypoints({ run: transcriptTransaction, roundAnalysis }),
    ...roundAnalysisReads({ database }),
    mediaSessions: createMediaSessionStore({
      database,
      run: transcriptTransaction,
      nextId: nextActorId,
    }),
    ...attendanceEntrypoints({
      run: transcriptTransaction,
      nextId: nextActorId,
    }),
    ...availabilityOperations(controlLane.client, dedicated),
    readUnratedRatingRounds: (
      input: Parameters<typeof readUnratedRatingRounds>[1],
    ) => readUnratedRatingRounds(database, input),
    ...databaseHealthOperations({
      database: control,
      dedicated,
      eventSink,
    }),
    /**
     * The RT-2.3b drain loop's LISTEN subscription (ADR 0032 §2, §3) on the
     * owner's dedicated connections, outside every lane and never handed out.
     */
    listenOutbox(handlers: OutboxListenHandlers) {
      return subscribeOutbox(dedicated, handlers);
    },
    /** Validated transient hints over a dedicated connection; durable drain is independent. */
    listenRealtimeHints(handlers: RealtimeHintHandlers) {
      return subscribeRealtimeHints(dedicated, handlers);
    },
    async close() {
      await workload.close();
      if (dedicated !== injectedClient) await dedicated.close({ timeout: 5 });
    },
    /** ISSUE-852: due observation purge jobs, delivered with one confirmed cache purge. */
    deliverObservationPurges: (
      input: Parameters<typeof deliverObservationPurges>[1],
      port: Parameters<typeof deliverObservationPurges>[2],
    ) =>
      instrumented(eventSink, 'deliverObservationPurges', () =>
        deliverObservationPurges(control, input, port),
      ),
    ...authOperations({ database: control, eventSink }),
    ...provisionalRetentionOperations({ database: control, eventSink }),
    ...authorizationSessionOperations({ database: control }),
    ...emailDeliveryOperations({ database: control, eventSink }),
    ...mailIntentOperations({ database: control, eventSink }),
    ...betaAccessOperations({ database: control, eventSink }),
    ...operatorAccountOperations({ database: control, eventSink }),
    ...actorOperations({ database: control, eventSink }),
    ...messagingOperations(social, contactReactions),
    ...friendshipReadOperations({ database: social, eventSink }),
    ...presenceSettingOperations({ database: social, eventSink }),
    friendStore: (authorize: ContactAuthorizationFence) =>
      createFriendStore({
        database: social,
        authorize,
        reactions: contactReactions,
      }),
    /** Contacts' own commands (blocks), with every registered reaction. */
    contactStore: (authorize: ContactAuthorizationFence) =>
      createContactStore({
        database: social,
        authorize,
        reactions: contactReactions,
      }),
    ...retainedConversationOperations({ database: social, eventSink }),
    ...outboxOperations({ database: control, eventSink }),
    ...transcriptRetention({ database: control, eventSink }),
    ...roundAnalysisRetention({ database: control, eventSink }),
    ...socialRequestRetention({ database: social, eventSink }),
    readOutboxRetentionBoundary: () =>
      instrumented(eventSink, 'readOutboxRetentionBoundary', () =>
        readOutboxRetentionBoundary(control),
      ),
    readOutboxCatchup: (
      topic: string,
      since: string,
      through: import('./outbox').OutboxPosition,
      limit?: number,
    ) =>
      instrumented(eventSink, 'readOutboxCatchup', () =>
        readOutboxCatchup(control, topic, since, through, limit),
      ),
    ...formatOperations({ database: audience, eventSink }),
    ...roomCommandOperations({
      database,
      botAdmission: admission,
      eventSink,
      commandTransaction: roomCommandTransaction(
        competitive.client,
        Math.max(
          1,
          Math.floor((profile.lanes.competitive?.connections ?? 0) / 2),
        ),
      ),
    }),
    ...roundOperations({ database, eventSink }),
    ...roundCommandOperations({ database, eventSink }),
    ...roundBallotOperations({ database, eventSink }),
    ...roundProtectedReads({ database }),
    ...roundSpeakingRead({ database }),
    ...utteranceOperations({ database, eventSink }),
    createMediaCaptureOperations: (
      input: Omit<Parameters<typeof mediaCaptureOperations>[0], 'transaction'>,
    ) =>
      mediaCaptureOperations({ ...input, transaction: transcriptTransaction }),
    ...transcriptFinalizationOperations({ database }),
    ...documentOperations({ database, eventSink }),
    ...onboardingOperations({ database: control, eventSink }),
    ...ageStepOperations({ database: control, eventSink }),
    ...standingsOperations({ database: audience, eventSink }),
    ...memberProfileReadOperations({ database: audience, eventSink }),
    /**
     * Rates a completed round with the caller's domain decision (ADR 0055,
     * ADR 0058); see `rateCompletedRound`. Its consumer is the ratings
     * feature; no production path calls that feature yet (RATE-2).
     */
    rateRound: (input: RateDebateInput) =>
      instrumented(eventSink, 'rateRound', () =>
        rateCompletedRound(database, input),
      ),
    /** Server-owned onboarding claim; see `claimUsername`. */
    claimUsername: (input: { userId: string; username: string }) =>
      claimUsername(control, input, nextActorId, eventSink),
  };
}
export type Database = ReturnType<typeof createDatabase>;
