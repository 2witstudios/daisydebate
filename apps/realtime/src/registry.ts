import {
  encodeOutboxCursor,
  OUTBOX_ORIGIN,
  type OutboxPosition,
  type OutboxRow,
} from '@daisy/db';
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
export type { SocketPrincipal, RegistrySocket } from './subscription-state';

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
}) {
  const connections = new Set<Connection>();
  let nextConnection = 0;
  const nativeTopic = (connection: Connection, topic: string) =>
    `${topic}#${connection.nativeId}`;
  let cursor = OUTBOX_ORIGIN;
  let ring: readonly OutboxRow[] = [];
  let floor = OUTBOX_ORIGIN;
  let pending = Promise.resolve();
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
    publish,
    event,
    transport: { detach, current, nativeTopic },
    remove,
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
          ...request,
        });
    },
    sink(rows: readonly OutboxRow[]) {
      delivery.invalidate(rows);
      const all = [...ring, ...rows];
      if (all.length > ringLimit) floor = all[all.length - ringLimit - 1]!;
      ring = all.slice(-ringLimit);
      const last = rows.at(-1);
      if (last) cursor = { txid: last.txid, seq: last.seq };
      pending = pending
        .catch(() => {})
        .then(async () => {
          for (const row of rows) await delivery.deliver(row);
        });
    },
    seed(position: OutboxPosition) {
      cursor = position;
      floor = position;
    },
    settled: () => pending,
  };
}
export type SubscriptionRegistry = ReturnType<
  typeof createSubscriptionRegistry
>;
export type RegistryConnection = ReturnType<SubscriptionRegistry['add']>;
