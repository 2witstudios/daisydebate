import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { sql } from 'drizzle-orm';
import {
  probeListen,
  subscribeOutbox,
  type OutboxListenHandlers,
} from './listen';
import { claimUsername } from './username-claim';
import { authOperations } from './auth-operations';
import { authorizationSessionOperations } from './authorization-session';
import { formatOperations } from './format-operations';
import { roomCommandOperations } from './room-command-operations';
import { roomOperations } from './room-operations';
import { roundOperations } from './round-operations';
import { utteranceOperations } from './utterance-operations';
import { ballotOperations } from './ballot-operations';
import { agentOperations } from './agent-operations';
import { documentOperations } from './document-operations';
import { onboardingOperations } from './onboarding-operations';
import {
  createMessagingStore,
  createMessagingFileStore,
  type MessagingAuthorizationFence,
} from './messaging';
import { actorOperations } from './actor-operations';
import { rateCompletedRound } from './rating-operations';
import { standingsOperations } from './standings';
import type { RateDebateInput } from './rating-facts';
import { emailDeliveryOperations } from './email-delivery-operations';
import { outboxOperations } from './outbox';
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
}: {
  url: string;
  maxConnections?: number;
  eventSink?: DatabaseEventSink;
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
  const database = drizzle({ client });
  return {
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
    async close() {
      await client.close({ timeout: 5 });
    },
    ...authOperations({ database, eventSink }),
    ...authorizationSessionOperations({ database }),
    ...emailDeliveryOperations({ database, eventSink }),
    ...actorOperations({ database, eventSink }),
    messagingFileStore: (
      authorize: Parameters<typeof createMessagingFileStore>[0]['authorize'],
    ) => createMessagingFileStore({ database, authorize }),
    messagingChannelStore: (authorize: MessagingAuthorizationFence) =>
      createMessagingStore({ database, authorize }),
    ...outboxOperations({ database, eventSink }),
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
    ...roomCommandOperations({ database, eventSink }),
    ...roundOperations({ database, eventSink }),
    ...utteranceOperations({ database, eventSink }),
    ...ballotOperations({ database, eventSink }),
    ...agentOperations({ database, eventSink }),
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
