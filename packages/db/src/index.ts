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
import { debateOperations } from './debate-operations';
import { actorOperations } from './actor-operations';
import { emailDeliveryOperations } from './email-delivery-operations';
import { outboxOperations } from './outbox';
import { instrumented, type DatabaseEventSink } from './instrumented';
import {
  runtimeRoleFactsFrom,
  runtimeRoleFactsQuery,
  runtimeRoleProblems,
  type RuntimeRoleFactsRow,
} from './runtime-role';
import { RUNTIME_SESSION } from './session-bounds';
export type {
  DebateMode,
  DebateOutcome,
  DebateVisibility,
} from './schema/debates';
export type { DebateRecord, NewDebate } from './debate-record';
export type { UsernameClaim } from './username-claim';
export type { ActorRecord } from './actor-operations';
export type { FormatRecord } from './debate-operations';
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
 * Composes the auth, debates, actor, email and outbox areas over one
 * connection pool (ISSUE-8 AC1): every area receives only the opaque Drizzle
 * handle and the event sink, never the raw client, and returns records, not
 * rows. `transaction`, `createUser`, `saveSnapshot` and the raw `outbox`
 * table have no production consumer (review T5) and are deliberately absent
 * from this surface — `packages/db`'s own tests reach them through
 * `test-only-operations.ts` and direct submodule imports instead.
 */
export function createDatabase({
  url,
  maxConnections = 10,
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
   * silently falling back to an ambient one. The application edge injects its
   * clock/id source (`@daisy/clock`'s `systemId.next`); a caller with no
   * production writes of its own (a read-only script, a fixture) still names
   * one, such as `@paralleldrive/cuid2`'s `createId` directly.
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
    ...emailDeliveryOperations({ database, eventSink }),
    ...actorOperations({ database, eventSink }),
    ...outboxOperations({ database, eventSink }),
    ...debateOperations({ database, eventSink }),
    /** Server-owned onboarding claim; see `claimUsername`. */
    claimUsername: (input: { userId: string; username: string }) =>
      claimUsername(database, input, nextActorId, eventSink),
  };
}
export type Database = ReturnType<typeof createDatabase>;
