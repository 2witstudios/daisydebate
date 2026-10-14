import { guardedObservationHeaders } from './observation-header-operation';
import { createObservationProjectionOperations } from './observation-projection';
import { createObservationAuthorityOperations } from './observation-authority';
import {
  createProfileExecutor,
  type DatabaseWorkloadProfile,
} from './workload-admission';
import { workloadDatabase } from './workload-executor';
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
import { createMessagingInboxPage } from './messaging/inbox-page';
import { createMessagingChannelAuthority } from './messaging/authority-frame';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { sql } from 'drizzle-orm';
import {
  probeListen,
  subscribeOutbox,
  type OutboxListenHandlers,
} from './listen';
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
import { roundOperations } from './round-operations';
import { utteranceOperations } from './utterance-operations';
import { ballotOperations } from './ballot-operations';
import { agentOperations } from './agent-operations';
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
import { actorOperations } from './actor-operations';
import { rateCompletedRound } from './rating-operations';
import { standingsOperations } from './standings';
import type { RateDebateInput } from './rating-facts';
import { emailDeliveryOperations } from './email-delivery-operations';
import { outboxOperations } from './outbox';
import { relayOutboxOperations } from './outbox-relay';
import { readOutboxCatchup } from './outbox-catchup';
import { readOutboxRetentionBoundary } from './outbox-retention-boundary';
import { instrumented, type DatabaseEventSink } from './instrumented';
import {
  runtimeRoleFactsFrom,
  runtimeRoleFactsQuery,
  runtimeRoleProblems,
  type RuntimeRoleFactsRow,
} from './runtime-role';
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
export type { NewRoom, RoomRecord } from './room-operations';
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
export { isCapacityRefusal } from './workload-admission';

/**
 * Composes the auth, format, room, round, utterance, ballot, agent,
 * document, actor, email and outbox areas over one connection pool
 * (ISSUE-8 AC1): every area receives only the opaque Drizzle handle and
 * the event sink, never the raw client, and returns records, not rows.
 * The competitive kernel persists what the caller's domain decisions
 * resolve — the composition root (the app) injects the engine.
 */
/** Connections in one process's pool unless a caller asks for another size. */
export const DEFAULT_MAX_CONNECTIONS = 12;

export function createDatabase({
  url,
  maxConnections = DEFAULT_MAX_CONNECTIONS,
  eventSink,
  client: injectedClient,
  nextActorId,
  workloadProfile = 'web',
  fairnessKey,
}: {
  url: string;
  maxConnections?: number;
  workloadProfile?: DatabaseWorkloadProfile;
  eventSink?: DatabaseEventSink;
  /** The current caller's fairness key; queued lane work is served round-robin across keys. */
  fairnessKey?: () => string | undefined;
  /** Overrides dialing `url`; tests inject a scripted client at this seam. */
  client?: SQL;
  /**
   * The cuid2 source for actor rows created at onboarding (ACTOR-1). Required,
   * not defaulted: every caller states its id strategy explicitly rather than
   * silently falling back to an ambient one.
   */
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
  const rawDatabase = drizzle({ client });
  const executor = createProfileExecutor(workloadProfile, maxConnections, {
    ...(fairnessKey ? { fairnessKey } : {}),
    onRefused: (lane, reason) =>
      eventSink?.(
        'db.capacity.refused',
        { scope: lane, cause: reason },
        'Database lane refused work',
      ),
  });
  const database = workloadDatabase(rawDatabase, executor, 'control');
  const competitiveDatabase = workloadDatabase(
    rawDatabase,
    executor,
    'competitive',
  );
  const socialDatabase = workloadDatabase(rawDatabase, executor, 'social');
  const authorityDatabase = workloadDatabase(
    rawDatabase,
    executor,
    'admission',
  );
  const headersDatabase = workloadDatabase(rawDatabase, executor, 'headers');
  const projectionDatabase = workloadDatabase(
    rawDatabase,
    executor,
    'projection',
  );
  const renewalDatabase = workloadDatabase(rawDatabase, executor, 'renewal');
  const relayDatabase = workloadDatabase(rawDatabase, executor, 'relay');
  return {
    observationAuthority: (
      decide: Parameters<typeof createObservationAuthorityOperations>[1],
    ) =>
      createObservationAuthorityOperations(
        { admission: authorityDatabase, renewal: renewalDatabase },
        decide,
      ),
    readObservationHeaders: (
      resources: Parameters<typeof guardedObservationHeaders>[1],
      guard?: Parameters<typeof guardedObservationHeaders>[2],
    ) => guardedObservationHeaders(headersDatabase, resources, guard),
    ...createObservationProjectionOperations(projectionDatabase),
    async health() {
      return instrumented(eventSink, 'health', async () => {
        await database.execute(sql`select 1`);
        return true;
      });
    },
    /**
     * The database this connection actually landed on, from the server
     * itself (`current_database()`), never parsed back out of `url`.
     */
    async currentDatabaseName(): Promise<string> {
      return instrumented(eventSink, 'currentDatabaseName', async () => {
        const [row] = (await database.execute(
          sql`select current_database() as name`,
        )) as unknown as Array<{ name: string }>;
        return row!.name;
      });
    },
    async checkListen() {
      return instrumented(eventSink, 'checkListen', async () => {
        await probeListen(client);
        return true;
      });
    },
    /**
     * How the connected role could create or alter schema objects in
     * `public` (ISSUE-39); empty for the DML-only runtime role. Production
     * startup refuses to serve unless it is empty.
     */
    async runtimeRoleProblems() {
      return instrumented(eventSink, 'runtimeRoleProblems', async () => {
        const [row] = (await database.execute(
          runtimeRoleFactsQuery,
        )) as unknown as RuntimeRoleFactsRow[];
        // No row means no schema public: nothing proves the role is safe.
        if (row === undefined) throw new Error('Schema public is missing');
        return runtimeRoleProblems(runtimeRoleFactsFrom(row));
      });
    },
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
    // Web session reads serve every page render; realtime revalidates on its admission lane.
    ...authorizationSessionOperations({
      database: workloadProfile === 'web' ? database : authorityDatabase,
    }),
    ...emailDeliveryOperations({ database, eventSink }),
    ...actorOperations({ database, eventSink }),
    messagingInboxPage: createMessagingInboxPage(socialDatabase),
    messagingDmStore: (
      authorize: Parameters<typeof createMessagingDmStore>[0]['authorize'],
    ) => createMessagingDmStore({ database: socialDatabase, authorize }),
    messagingChannelAuthority: createMessagingChannelAuthority(socialDatabase),
    messagingFileMaintenance: createMessagingFileMaintenance(socialDatabase),
    messagingFileCleanup: (
      authorize: Parameters<typeof createMessagingFileCleanup>[0]['authorize'],
    ) => createMessagingFileCleanup({ database: socialDatabase, authorize }),
    messagingFileStore: (
      authorize: Parameters<typeof createMessagingFileStore>[0]['authorize'],
    ) => createMessagingFileStore({ database: socialDatabase, authorize }),
    messagingTypingStore: createMessagingTypingStore(socialDatabase),
    messagingTypingPrivacyPort: (
      producer: Parameters<typeof createMessagingTypingPrivacyPort>[1],
    ) => createMessagingTypingPrivacyPort(socialDatabase, producer),
    messagingPreferenceStore: (
      authorize: Parameters<typeof createMessagingPreferenceStore>[1],
    ) => createMessagingPreferenceStore(socialDatabase, authorize),
    messagingChannelStore: (authorize: MessagingAuthorizationFence) =>
      createMessagingStore({ database: socialDatabase, authorize }),
    messagingReactionStore: (
      policy: Parameters<typeof createMessagingReactionStore>[1],
      authorize: Parameters<typeof createMessagingReactionStore>[2],
    ) => createMessagingReactionStore(socialDatabase, policy, authorize),
    messagingGroupCreationStore: (authorize: MessagingGroupCreationFence) =>
      createMessagingGroupCreationStore(socialDatabase, authorize),
    messagingGroupIssuanceStore: (authorize: MessagingGroupIssuanceFence) =>
      createMessagingGroupIssuanceStore({
        database: socialDatabase,
        authorize,
      }),
    messagingGroupManagementStore: (authorize: MessagingGroupManagementFence) =>
      createMessagingGroupManagementStore({
        database: socialDatabase,
        authorize,
      }),
    messagingGroupInvitationStore: (authorize: MessagingGroupInvitationFence) =>
      createMessagingGroupInvitationStore({
        database: socialDatabase,
        authorize,
      }),
    messagingSocialStore: (authorize: MessagingSocialAuthorizationFence) =>
      createMessagingSocialStore({ database: socialDatabase, authorize }),
    ...outboxOperations({ database, eventSink }),
    /** The fleet metadata relay; only the projection profile reserves its lane. */
    relayOutbox: relayOutboxOperations({ database: relayDatabase, eventSink }),
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
    ...formatOperations({ database: competitiveDatabase, eventSink }),
    ...roomOperations({ database: competitiveDatabase, eventSink }),
    ...roomCommandOperations({
      database: competitiveDatabase,
      eventSink,
      commandTransaction: roomCommandTransaction(competitiveDatabase),
    }),
    ...roundOperations({ database: competitiveDatabase, eventSink }),
    ...utteranceOperations({ database: competitiveDatabase, eventSink }),
    ...ballotOperations({ database: competitiveDatabase, eventSink }),
    ...agentOperations({ database: competitiveDatabase, eventSink }),
    ...documentOperations({ database, eventSink }),
    ...onboardingOperations({ database, eventSink }),
    ...standingsOperations({ database: competitiveDatabase, eventSink }),
    /**
     * Rates a completed round with the caller's domain decision (ADR 0055,
     * ADR 0058); see `rateCompletedRound`. Its consumer is the ratings
     * feature; no production path calls that feature yet (RATE-2).
     */
    rateRound: (input: RateDebateInput) =>
      instrumented(eventSink, 'rateRound', () =>
        rateCompletedRound(competitiveDatabase, input),
      ),
    /** Server-owned onboarding claim; see `claimUsername`. */
    claimUsername: (input: { userId: string; username: string }) =>
      claimUsername(database, input, nextActorId, eventSink),
  };
}
export type Database = ReturnType<typeof createDatabase>;
