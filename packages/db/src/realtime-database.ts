import type { SQL } from 'bun';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { authorizationSessionOperations } from './authorization-session';
import { availabilityOperations } from './availability-operations';
import { databaseHealthOperations } from './database-health';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { subscribeOutbox, type OutboxListenHandlers } from './listen';
import {
  createMessagingChannelAuthority,
  createMessagingChannelCohortAuthority,
} from './messaging/authority-frame';
import { channelObservationReads } from './messaging/observation-reads';
import { outboxOperations, type OutboxPosition } from './outbox';
import { readOutboxCatchup } from './outbox-catchup';
import { readOutboxRetentionBoundary } from './outbox-retention-boundary';
import {
  subscribeRealtimeHints,
  type RealtimeHintHandlers,
} from './realtime-hints';
import { roomAuthorizationRead } from './room-authorization-read';
import { createWorkload, dialDedicated, dialLanes } from './workload';
import { WORKLOAD_PROFILES, type WorkloadProfile } from './workload-admission';

/**
 * The shared-fence authority reads a socket subscription needs, on one
 * lane: subscribes (`admission`) and renewals (`renewal`) are composed
 * separately, so an admission wave cannot consume renewal capacity.
 */
const authorityReads = (database: BunSQLDatabase) => ({
  ...authorizationSessionOperations({ database }),
  ...roomAuthorizationRead({ database }),
  messagingChannelAuthority: createMessagingChannelAuthority(database),
  messagingChannelCohortAuthority:
    createMessagingChannelCohortAuthority(database),
});
export type RealtimeAuthorityReads = ReturnType<typeof authorityReads>;

/**
 * The realtime process's database (ADR 0088): only what the socket server
 * reads, each on its own lane. It never composes Round, Room or messaging
 * commands, so a realtime process cannot spend connections on them.
 */
export function createRealtimeDatabase({
  url,
  profile = WORKLOAD_PROFILES.realtime,
  eventSink,
  client: injectedClient,
}: {
  url: string;
  profile?: WorkloadProfile;
  eventSink?: DatabaseEventSink;
  /** Overrides dialing `url` for every lane; tests inject a client at this seam. */
  client?: SQL;
}) {
  const workload = createWorkload({
    profile,
    connect: injectedClient ? () => injectedClient : dialLanes(url),
  });
  const admission = workload.lane('admission').database;
  const control = workload.lane('control');
  const dedicated =
    injectedClient ?? dialDedicated(url, Math.max(1, profile.dedicated));
  return {
    admission: authorityReads(admission),
    renewal: authorityReads(workload.lane('renewal').database),
    /**
     * Observation owner reads (ADR 0089), only on a profile that reserves
     * the headers and projection lanes; null on a fanout-only process.
     */
    observation:
      profile.lanes.headers && profile.lanes.projection
        ? {
            headers: channelObservationReads(workload.lane('headers').database),
            projection: channelObservationReads(
              workload.lane('projection').database,
            ),
          }
        : null,
    ...outboxOperations({ database: control.database, eventSink }),
    readOutboxRetentionBoundary: () =>
      instrumented(eventSink, 'readOutboxRetentionBoundary', () =>
        readOutboxRetentionBoundary(control.database),
      ),
    /** Subscribe-time replay from a cursor: admission work, never the drain's lane. */
    readOutboxCatchup: (
      topic: string,
      since: string,
      through: OutboxPosition,
      limit?: number,
    ) =>
      instrumented(eventSink, 'readOutboxCatchup', () =>
        readOutboxCatchup(admission, topic, since, through, limit),
      ),
    renewServiceInstance: availabilityOperations(control.client, dedicated)
      .renewServiceInstance,
    ...databaseHealthOperations({
      database: control.database,
      dedicated,
      eventSink,
    }),
    /** The drain loop's LISTEN (ADR 0032 §2, §3), on a dedicated connection. */
    listenOutbox(handlers: OutboxListenHandlers) {
      return subscribeOutbox(dedicated, handlers);
    },
    /** Validated transient hints; durable drain is independent. */
    listenRealtimeHints(handlers: RealtimeHintHandlers) {
      return subscribeRealtimeHints(dedicated, handlers);
    },
    async close() {
      await workload.close();
      if (dedicated !== injectedClient) await dedicated.close({ timeout: 5 });
    },
  };
}
export type RealtimeDatabase = ReturnType<typeof createRealtimeDatabase>;
