import { createMediaSessionStore } from './media-session';
import { roundUnjudgedCompletionOperations } from './round-unjudged-completion';
import { roundMaintenanceOperations } from './round-maintenance';
import {
  roundWorkerEntrypoints,
  type JudgingOptions,
  type BotPublicationOptions,
} from './round-worker-entrypoints';
import { attendanceEntrypoints } from './attendance-entrypoints';
import { availabilityOperations } from './availability-operations';
import { databaseHealthOperations } from './database-health';
import { roundBallotOperations } from './round-ballot-operations';
import { roundBotAdmissionEntrypoints } from './round-bot-admission-entrypoints';
import { mediaCaptureOperations } from './media-capture';
import { roundSpeakingRead } from './round-speaking-read';
import { createBoundedTransaction } from './bounded-transaction';
export { isTransactionCapacityRefusal } from './transaction-admission';
import { readUnratedAttendanceForfeits } from './attendance-rating';
import { roundProtectedReads } from './round-protected-reads';
import { createMessagingTypingPrivacyPort } from './privacy/typing-rights';
import { createMessagingTypingStore } from './messaging/typing-store';
import { createMessagingPreferenceStore } from './messaging/preference-store';
import { createMessagingFileMaintenance } from './messaging-files/maintenance';
import { createMessagingGroupIssuanceStore } from './messaging/group-issuance-store';
import type { MessagingGroupIssuanceFence } from './messaging/group-issuance-contracts';
import { createMessagingGroupManagementStore } from './messaging/group-management-store';
import type { MessagingGroupManagementFence } from './messaging/group-management-contracts';
import { createMessagingGroupCreationStore } from './messaging/group-creation-store';
import type { MessagingGroupCreationFence } from './messaging/group-creation-contracts';
import { createMessagingGroupInvitationStore } from './messaging/group-invitation-store';
import type { MessagingGroupInvitationFence } from './messaging/group-invitation-contracts';
import { createMessagingInboxStore } from './messaging/inbox-store';
import { createMessagingChannelAuthority } from './messaging/authority-frame';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { subscribeOutbox, type OutboxListenHandlers } from './listen';
import {
  subscribeRealtimeHints,
  type RealtimeHintHandlers,
} from './realtime-hints';
import { claimUsername } from './username-claim';
import { authOperations } from './auth-operations';
import { authorizationSessionOperations } from './authorization-session';
import { formatOperations } from './format-operations';
import { roomCommandOperations } from './room-command-operations';
import { roomCommandTransaction } from './room-command-transaction';
import { roomOperations } from './room-operations';
import { roundCommandOperations } from './round-command-operations';
import { roundOperations } from './round-operations';
import { transcriptFinalizationOperations } from './transcript-finalization';
import { utteranceOperations } from './utterance-operations';
import { documentOperations } from './document-operations';
import { onboardingOperations } from './onboarding-operations';
import {
  createMessagingStore,
  createMessagingReactionStore,
  createMessagingFileStore,
  createMessagingDmStore,
  createMessagingFileCleanup,
  type MessagingAuthorizationFence,
  createMessagingSocialStore,
  type MessagingSocialAuthorizationFence,
} from './messaging';
import { listMessagingFriendships } from './messaging/friendships';
import { actorOperations } from './actor-operations';
import { rateCompletedRound } from './rating-operations';
import { standingsOperations } from './standings';
import type { RateDebateInput } from './rating-facts';
import { emailDeliveryOperations } from './email-delivery-operations';
import { outboxOperations } from './outbox';
import { transcriptRetention } from './transcript-retention';
import { readOutboxCatchup } from './outbox-catchup';
import { readOutboxRetentionBoundary } from './outbox-retention-boundary';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { RUNTIME_SESSION } from './session-bounds';
export type {
  RateDebateInput,
  RateDebateResult,
  RatingDecision,
} from './rating-facts';
export type {
  FormatRevisionRecord,
  FormatPresetRecord,
} from './format-operations';
export type { NewRoom } from './room-operations';
export type { RoundHydration } from './round-hydration';
export type { RoundExecutionWrite } from './round-operations';
export type { DocumentRecord, DocumentSave } from './document-operations';
export type { ActorRecord } from './actor-operations';
export type { UsernameClaim } from './username-claim';
export type {
  OnboardingRecord,
  OnboardingStepWrite,
} from './onboarding-operations';
export type { StandingsRead } from './standings';
export type { DatabaseEventSink } from './instrumented';
export {
  encodeOutboxCursor,
  decodeOutboxCursor,
  OUTBOX_ORIGIN,
  type OutboxAppendInput,
  type OutboxPosition,
  type OutboxRow,
} from './outbox';
export { refuseSchemaAlteringRole } from './runtime-role';

/**
 * Composes the auth, format, room, round, utterance, ballot, agent,
 * document, actor, email and outbox areas over one connection pool
 * (ISSUE-8 AC1): every area receives only the opaque Drizzle handle and
 * the event sink, never the raw client, and returns records, not rows.
 * The competitive kernel persists what the caller's domain decisions
 * resolve — the composition root (the app) injects the engine.
 */
/** Connections in one process's pool unless a caller asks for another size. */
export const DEFAULT_MAX_CONNECTIONS = 10;

export function createDatabase({
  url,
  maxConnections = DEFAULT_MAX_CONNECTIONS,
  eventSink,
  client: injectedClient,
  nextActorId,
  botBusyCap,
  judging,
  botPublication,
}: {
  url: string;
  maxConnections?: number;
  /** No implicit bot capacity: absence truthfully refuses bot admission. */
  botBusyCap?: number | undefined;
  judging?: JudgingOptions | undefined;
  botPublication?: BotPublicationOptions | undefined;
  eventSink?: DatabaseEventSink;
  /** Overrides dialing `url`; tests inject a scripted client at this seam. */
  client?: SQL;
  /** Required cuid2 source for onboarding actors and durable Round usage IDs. */
  nextActorId: () => string;
}) {
  const client =
    injectedClient ??
    new SQL(url, {
      max: maxConnections,
      connectionTimeout: 3,
      idleTimeout: 20,
      connection: RUNTIME_SESSION,
    });
  const database = drizzle({ client });
  const transcriptTransaction = createBoundedTransaction({
    client,
    maxConnections,
    now: performance.now,
  });
  const { admission: botAdmission, operations: botAdmissionOperations } =
    roundBotAdmissionEntrypoints({
      run: transcriptTransaction,
      nextId: nextActorId,
      busyCap: botBusyCap,
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
    mediaSessions: createMediaSessionStore({
      database,
      run: transcriptTransaction,
      nextId: nextActorId,
    }),
    ...attendanceEntrypoints({
      run: transcriptTransaction,
      nextId: nextActorId,
    }),
    ...availabilityOperations(client),
    readUnratedAttendanceForfeits: (
      input: Parameters<typeof readUnratedAttendanceForfeits>[1],
    ) => readUnratedAttendanceForfeits(database, input),
    ...databaseHealthOperations({ database, client, eventSink }),
    /**
     * The RT-2.3b drain loop's LISTEN subscription (ADR 0032 §2, §3): the
     * raw client only `createDatabase` holds, never handed out as the
     * opaque Drizzle handle other operations receive.
     */
    listenOutbox(handlers: OutboxListenHandlers) {
      return subscribeOutbox(client, handlers);
    },
    /** Validated transient hints over the same pool; durable drain is independent. */
    listenRealtimeHints(handlers: RealtimeHintHandlers) {
      return subscribeRealtimeHints(client, handlers);
    },
    async close() {
      await client.close({ timeout: 5 });
    },
    ...authOperations({ database, eventSink }),
    ...authorizationSessionOperations({ database }),
    ...emailDeliveryOperations({ database, eventSink }),
    ...actorOperations({ database, eventSink }),
    messagingInboxStore: (
      authorize: Parameters<typeof createMessagingInboxStore>[1],
    ) => createMessagingInboxStore(database, authorize),
    messagingDmStore: (
      authorize: Parameters<typeof createMessagingDmStore>[0]['authorize'],
    ) => createMessagingDmStore({ database, authorize }),
    messagingChannelAuthority: createMessagingChannelAuthority(database),
    messagingFileMaintenance: createMessagingFileMaintenance(database),
    messagingFileCleanup: (
      authorize: Parameters<typeof createMessagingFileCleanup>[0]['authorize'],
    ) => createMessagingFileCleanup({ database, authorize }),
    messagingFileStore: (
      authorize: Parameters<typeof createMessagingFileStore>[0]['authorize'],
    ) => createMessagingFileStore({ database, authorize }),
    messagingTypingStore: createMessagingTypingStore(database),
    messagingTypingPrivacyPort: (
      producer: Parameters<typeof createMessagingTypingPrivacyPort>[1],
    ) => createMessagingTypingPrivacyPort(database, producer),
    messagingPreferenceStore: (
      authorize: Parameters<typeof createMessagingPreferenceStore>[1],
    ) => createMessagingPreferenceStore(database, authorize),
    messagingChannelStore: (authorize: MessagingAuthorizationFence) =>
      createMessagingStore({ database, authorize }),
    messagingReactionStore: (
      policy: Parameters<typeof createMessagingReactionStore>[1],
      authorize: Parameters<typeof createMessagingReactionStore>[2],
    ) => createMessagingReactionStore(database, policy, authorize),
    messagingGroupCreationStore: (authorize: MessagingGroupCreationFence) =>
      createMessagingGroupCreationStore(database, authorize),
    messagingGroupIssuanceStore: (authorize: MessagingGroupIssuanceFence) =>
      createMessagingGroupIssuanceStore({ database, authorize }),
    messagingGroupManagementStore: (authorize: MessagingGroupManagementFence) =>
      createMessagingGroupManagementStore({ database, authorize }),
    messagingGroupInvitationStore: (authorize: MessagingGroupInvitationFence) =>
      createMessagingGroupInvitationStore({ database, authorize }),
    messagingSocialStore: (authorize: MessagingSocialAuthorizationFence) =>
      createMessagingSocialStore({ database, authorize }),
    /** One member's own friendships and requests (ADR 0072). */
    listMessagingFriendships: (actorId: string) =>
      instrumented(eventSink, 'listMessagingFriendships', () =>
        listMessagingFriendships(database, actorId),
      ),
    ...outboxOperations({ database, eventSink }),
    ...transcriptRetention({ database, eventSink }),
    readOutboxRetentionBoundary: () =>
      instrumented(eventSink, 'readOutboxRetentionBoundary', () =>
        readOutboxRetentionBoundary(database),
      ),
    readOutboxCatchup: (
      topic: string,
      since: string,
      through: import('./outbox').OutboxPosition,
      limit?: number,
    ) =>
      instrumented(eventSink, 'readOutboxCatchup', () =>
        readOutboxCatchup(database, topic, since, through, limit),
      ),
    ...formatOperations({ database, eventSink }),
    ...roomOperations({ database, eventSink }),
    ...roomCommandOperations({
      database,
      botAdmission,
      eventSink,
      commandTransaction: roomCommandTransaction(client, maxConnections),
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
    ...onboardingOperations({ database, eventSink }),
    ...standingsOperations({ database, eventSink }),
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
      claimUsername(database, input, nextActorId, eventSink),
  };
}
export type Database = ReturnType<typeof createDatabase>;

export type { LockedRoundCommandContext } from './round-command-operations';

export type { FrozenRoundTranscript } from './frozen-transcript';

export type {
  LockedRoundBallotInput,
  LockedRoundBallotContext,
  RoundBallotLeaseContext,
} from './round-ballot-operations';
export type {
  AttendanceTransactionContext,
  AttendanceTransaction,
  AttendancePrincipal,
  AttendanceFacts,
  LockedAttendanceCheckIn,
} from './attendance-operations';
export type { AttendanceEvaluationFacts } from './attendance-evaluator';
export type { AttendanceResolution } from './attendance-adjudication';
export type {
  AvailabilityEvidence,
  AvailabilityCause,
} from './availability-operations';
export type {
  CheckInAttempt,
  CheckInAttemptMetadata,
} from './check-in-attempts';

export type {
  AttendanceStore,
  AttendanceEvaluator,
} from './attendance-entrypoints';
