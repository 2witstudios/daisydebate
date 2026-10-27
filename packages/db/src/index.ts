import { messagingOperations } from './messaging/operations';
import { friendshipReadOperations } from './messaging/friendships';
import { createMediaSessionStore } from './media-session';
import { roundUnjudgedCompletionOperations } from './round-unjudged-completion';
import { roundMaintenanceOperations } from './round-maintenance';
import {
  roundWorkerEntrypoints,
  type JudgingOptions,
  type BotPublicationOptions,
  type CoachingOptions,
} from './round-worker-entrypoints';
import { attendanceEntrypoints } from './attendance-entrypoints';
import { availabilityOperations } from './availability-operations';
import { databaseHealthOperations } from './database-health';
import { roundBallotOperations } from './round-ballot-operations';
import { roundBotAdmissionEntrypoints } from './round-bot-admission-entrypoints';
import { mediaCaptureOperations } from './media-capture';
import { roundSpeakingRead } from './round-speaking-read';
import { createBoundedTransaction } from './bounded-transaction';
import { readUnratedAttendanceForfeits } from './attendance-rating';
import { roundProtectedReads } from './round-protected-reads';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
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
import { readOutboxCatchup } from './outbox-catchup';
import { readOutboxRetentionBoundary } from './outbox-retention-boundary';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { RUNTIME_SESSION } from './session-bounds';
export type { DatabaseEventSink } from './instrumented';
export type {
  ProvisionalLinkPurposes,
  ProvisionalMailCleanup,
} from './provisional-cleanup';
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
  coaching,
}: {
  url: string;
  maxConnections?: number;
  /** No implicit bot capacity: absence truthfully refuses bot admission. */
  botBusyCap?: number | undefined;
  judging?: JudgingOptions | undefined;
  botPublication?: BotPublicationOptions | undefined;
  coaching?: CoachingOptions | undefined;
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
      coaching,
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
    ...provisionalRetentionOperations({ database, eventSink }),
    ...authorizationSessionOperations({ database }),
    ...emailDeliveryOperations({ database, eventSink }),
    ...mailIntentOperations({ database, eventSink }),
    ...betaAccessOperations({ database, eventSink }),
    ...operatorAccountOperations({ database, eventSink }),
    ...actorOperations({ database, eventSink }),
    ...messagingOperations(database),
    ...friendshipReadOperations({ database, eventSink }),
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
    ...ageStepOperations({ database, eventSink }),
    ...standingsOperations({ database, eventSink }),
    ...memberProfileReadOperations({ database, eventSink }),
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
