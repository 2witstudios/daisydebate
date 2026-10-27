import {
  encodeOutboxCursor,
  OUTBOX_ORIGIN,
  type OutboxPosition,
  type OutboxRow,
} from '@daisy/db/outbox';
import {
  ENVELOPE_VERSION,
  isPayloadDeliverableOnTopic,
  outboxPayloadSchema,
  type ServerMessage,
} from '@daisy/protocol';

import {
  compare,
  type SocketPrincipal,
  type RegistrySocket,
  type Subscription,
  type Connection,
} from './subscription-state';
import { createSubscriptionReceiver } from './subscription-replay';
import { createSubscriptionDelivery } from './subscription-delivery';
import { createDeliveryScheduler } from './delivery-scheduler';
export type { SocketPrincipal, RegistrySocket } from './subscription-state';

/** At most 8 topics deliver at once; 64 rows per topic and 1,024 in all are retained. */
const DELIVERY_BOUNDS = {
  maxRunningTopics: 8,
  maxPerTopic: 64,
  maxRetained: 1024,
} as const;

/** Owns transport state only. Canonical authority and retained history are
 * injected public producer adapters; payloads never grant membership.
 */
export function createSubscriptionRegistry({
  now,
  lifetimeMs,
  ringLimit,
  maxSubscriptions,
  authorize,
  readCatchup,
  readRetentionBoundary,
  publish,
  failed,
}: {
  readonly now: () => number;
  readonly lifetimeMs: number;
  readonly ringLimit: number;
  readonly maxSubscriptions: number;
  readonly authorize: (
    principal: SocketPrincipal,
    topic: string,
  ) => Promise<{
    readonly revision: string;
    readonly validUntil: number;
  } | null>;
  readonly readCatchup: (
    topic: string,
    since: string,
    through: OutboxPosition,
  ) => Promise<{
    readonly rows: readonly OutboxRow[];
    readonly resync: boolean;
  }>;
  readonly readRetentionBoundary: () => Promise<OutboxPosition | null>;
  readonly publish: (topic: string, frame: ServerMessage) => void;
  /** Reports an authority read that failed rather than decided. */
  readonly failed: (error: unknown) => void;
}) {
  const connections = new Set<Connection>();
  let nextConnection = 0;
  const nativeTopic = (connection: Connection, topic: string) =>
    `${topic}#${connection.nativeId}`;
  let cursor = OUTBOX_ORIGIN;
  let ring: readonly OutboxRow[] = [];
  let floor = OUTBOX_ORIGIN;
  function detach(
    connection: Connection,
    topic: string,
    subscription: Subscription,
  ) {
    subscription.lease.invalidate();
    if (subscription.attached)
      connection.socket.unsubscribe(nativeTopic(connection, topic));
    subscription.attached = false;
  }
  function remove(connection: Connection) {
    connection.closed = true;
    for (const [topic, subscription] of connection.topics)
      detach(connection, topic, subscription);
    connection.topics.clear();
    connections.delete(connection);
  }
  const current = (connection: Connection, topic: string, sub: Subscription) =>
    !connection.closed &&
    connection.topics.get(topic) === sub &&
    sub.lease.current();
  function sendRow(
    connection: Connection,
    topic: string,
    sub: Subscription,
    row: OutboxRow,
  ) {
    if (!current(connection, topic, sub)) return false;
    if (compare(row, sub.delivered) <= 0) return true;
    if (isPayloadDeliverableOnTopic(row.topic, row.payload))
      connection.socket.send(event(row));
    sub.delivered = row;
    return true;
  }
  function event(row: OutboxRow): ServerMessage {
    return {
      v: ENVELOPE_VERSION,
      type: 'event',
      topic: row.topic,
      position: encodeOutboxCursor(row),
      payload: outboxPayloadSchema.parse(row.payload),
    };
  }
  function resync(
    connection: Connection,
    request: { id: string; topic: string },
    sub: Subscription,
  ) {
    detach(connection, request.topic, sub);
    connection.topics.delete(request.topic);
    connection.socket.send({
      v: ENVELOPE_VERSION,
      type: 'resync_required',
      id: request.id,
      topic: request.topic,
    });
  }
  const delivery = createSubscriptionDelivery({
    connections,
    authorize,
    failed,
    publish,
    event,
    transport: { detach, current, nativeTopic, resync },
    remove,
  });
  const scheduler = createDeliveryScheduler({
    ...DELIVERY_BOUNDS,
    deliver: delivery.deliver,
    // Rows this topic can no longer hold are not lost silently: every
    // subscriber rereads (RT-2.3c-arch1), and resync fences late allows.
    overflow(topic) {
      for (const connection of connections) {
        const sub = connection.topics.get(topic);
        if (sub) resync(connection, { id: sub.requestId, topic }, sub);
      }
    },
  });
  return {
    add(socket: RegistrySocket, principal: SocketPrincipal): Connection {
      const connection: Connection = {
        socket,
        principal,
        topics: new Map(),
        closed: false,
        nativeId: ++nextConnection,
      };
      connections.add(connection);
      return connection;
    },
    remove,
    revalidate: delivery.revalidate,
    hint: delivery.hint,
    closeAll() {
      for (const connection of connections) {
        remove(connection);
        connection.socket.close(4006, 'server_restarting');
      }
    },
    subscribe: createSubscriptionReceiver({
      now,
      lifetimeMs,
      maxSubscriptions,
      authorize,
      failed,
      readCatchup,
      readRetentionBoundary,
      snapshot: () => ({ cursor, floor, ring }),
      transport: { detach, current, sendRow, resync, nativeTopic },
    }),
    unsubscribe(
      connection: Connection,
      request: { readonly id: string; readonly topic: string },
    ) {
      const sub = connection.topics.get(request.topic);
      if (sub) detach(connection, request.topic, sub);
      connection.topics.delete(request.topic);
      if (!connection.closed)
        connection.socket.send({
          v: ENVELOPE_VERSION,
          type: 'unsubscribed',
          id: request.id,
          topic: request.topic,
        });
    },
    sink(rows: readonly OutboxRow[]) {
      delivery.invalidate(rows);
      const all = [...ring, ...rows];
      if (all.length > ringLimit) floor = all[all.length - ringLimit - 1]!;
      ring = all.slice(-ringLimit);
      const last = rows.at(-1);
      if (last) cursor = { txid: last.txid, seq: last.seq };
      // Only rows someone here is owed take delivery capacity: a late
      // subscriber replays from the ring, and control rows were applied above.
      const owed = delivery.observedTopics();
      scheduler.enqueue(
        rows.filter(
          (row) =>
            owed.has(row.topic) &&
            isPayloadDeliverableOnTopic(row.topic, row.payload),
        ),
      );
    },
    backlog: scheduler.backlog,
    seed(position: OutboxPosition) {
      cursor = position;
      floor = position;
    },
    async settled() {
      await scheduler.settled();
      await delivery.settledHints();
    },
  };
}
export type SubscriptionRegistry = ReturnType<
  typeof createSubscriptionRegistry
>;
export type RegistryConnection = ReturnType<SubscriptionRegistry['add']>;
