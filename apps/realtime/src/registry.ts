import {
  encodeOutboxCursor,
  OUTBOX_ORIGIN,
  type OutboxPosition,
  type OutboxRow,
} from '@daisy/db';
import {
  ENVELOPE_VERSION,
  isPayloadDeliverableOnTopic,
  isPayloadStorableOnTopic,
  outboxPayloadSchema,
  type ServerMessage,
} from '@daisy/protocol';
import { createAuthorityLease } from './authority-lease';

export type SocketPrincipal = {
  readonly actorId: string;
  readonly userId: string;
  readonly sessionId: string;
};
export type RegistrySocket = {
  readonly send: (frame: ServerMessage) => void;
  readonly subscribe: (topic: string) => void;
  readonly unsubscribe: (topic: string) => void;
  readonly close: (code: number, reason: string) => void;
};
type Subscription = {
  readonly lease: ReturnType<typeof createAuthorityLease>;
  revision: string;
  attached: boolean;
  delivered: OutboxPosition;
};
type Connection = {
  readonly socket: RegistrySocket;
  readonly principal: SocketPrincipal;
  readonly topics: Map<string, Subscription>;
  closed: boolean;
  readonly nativeId: number;
};
const compare = (a: OutboxPosition, b: OutboxPosition) =>
  BigInt(a.txid) < BigInt(b.txid)
    ? -1
    : BigInt(a.txid) > BigInt(b.txid)
      ? 1
      : a.seq < b.seq
        ? -1
        : a.seq > b.seq
          ? 1
          : 0;

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
  function control(row: OutboxRow) {
    if (!isPayloadStorableOnTopic(row.topic, row.payload)) return;
    const parsed = outboxPayloadSchema.safeParse(row.payload);
    if (!parsed.success) return;
    const payload = parsed.data;
    if (payload.kind !== 'session.revoked' && payload.kind !== 'access.revoked')
      return;
    for (const connection of connections) {
      if (connection.principal.actorId !== payload.ids[0]) continue;
      if (payload.kind === 'session.revoked') {
        if (payload.ids[1] && payload.ids[1] !== connection.principal.sessionId)
          continue;
        remove(connection);
        connection.socket.close(4002, 'revoked');
      } else {
        for (const [topic, sub] of connection.topics) {
          if (topic.split(':')[1] === payload.ids[1]) {
            detach(connection, topic, sub);
            connection.topics.delete(topic);
          }
        }
      }
    }
  }
  async function deliver(row: OutboxRow) {
    if (!isPayloadDeliverableOnTopic(row.topic, row.payload)) return;
    // No await between the final lease check/unsubscribe and native publish.
    // Channel activity triggers a fresh canonical read; it is never authority.
    for (const connection of connections) {
      const sub = connection.topics.get(row.topic);
      if (!sub?.attached) continue;
      if (!current(connection, row.topic, sub)) {
        detach(connection, row.topic, sub);
        continue;
      }
      if (row.kind === 'channel.changed' || row.kind === 'room.changed') {
        const attempt = sub.lease.begin(
          connection.principal.sessionId,
          sub.revision,
        );
        let decision;
        try {
          decision = await authorize(connection.principal, row.topic);
        } catch {
          decision = null;
        }
        if (connection.topics.get(row.topic) !== sub || connection.closed)
          continue;
        if (!sub.lease.owns(attempt)) continue;
        if (!decision || !sub.lease.accept(attempt, decision?.validUntil)) {
          detach(connection, row.topic, sub);
          continue;
        }
        sub.revision = decision.revision;
      }
    }
    for (const connection of connections) {
      const sub = connection.topics.get(row.topic);
      if (!sub?.attached) continue;
      if (!current(connection, row.topic, sub))
        detach(connection, row.topic, sub);
      else if (compare(row, sub.delivered) > 0) {
        try {
          publish(nativeTopic(connection, row.topic), event(row));
          sub.delivered = row;
        } catch {
          remove(connection);
          connection.socket.close(4005, 'slow_consumer');
        }
      }
    }
  }
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
    async revalidate(
      validatePrincipal: (principal: SocketPrincipal) => Promise<boolean>,
    ) {
      for (const connection of connections) {
        let valid = false;
        try {
          valid = await validatePrincipal(connection.principal);
        } catch {
          valid = false;
        }
        if (connection.closed) continue;
        if (!valid) {
          remove(connection);
          connection.socket.close(4002, 'revoked');
          continue;
        }
        for (const [topic, sub] of connection.topics) {
          // Detach expired authority before starting an entirely fresh attempt.
          if (!sub.lease.current()) detach(connection, topic, sub);
          const attempt = sub.lease.begin(
            connection.principal.sessionId,
            sub.revision,
          );
          let decision;
          try {
            decision = await authorize(connection.principal, topic);
          } catch {
            decision = null;
          }
          if (connection.closed || connection.topics.get(topic) !== sub)
            continue;
          if (!sub.lease.owns(attempt)) continue;
          if (!decision || !sub.lease.accept(attempt, decision.validUntil)) {
            detach(connection, topic, sub);
            connection.topics.delete(topic);
            continue;
          }
          sub.revision = decision.revision;
          if (!sub.attached) {
            connection.socket.subscribe(nativeTopic(connection, topic));
            sub.attached = true;
          }
        }
      }
    },
    closeAll() {
      for (const connection of connections) {
        remove(connection);
        connection.socket.close(4006, 'server_restarting');
      }
    },
    async subscribe(
      connection: Connection,
      request: {
        readonly id: string;
        readonly topic: string;
        readonly since?: string | undefined;
      },
    ) {
      if (connection.closed) return;
      const old = connection.topics.get(request.topic);
      if (old) detach(connection, request.topic, old);
      else if (connection.topics.size >= maxSubscriptions) {
        connection.socket.send({
          v: ENVELOPE_VERSION,
          type: 'error',
          id: request.id,
          code: 'RATE_LIMIT',
          message: 'Subscription limit reached',
        });
        return;
      }
      const sub: Subscription = {
        lease: createAuthorityLease({ now, lifetimeMs }),
        revision: '',
        attached: false,
        delivered: OUTBOX_ORIGIN,
      };
      connection.topics.set(request.topic, sub);
      const attempt = sub.lease.begin(
        connection.principal.sessionId,
        sub.revision,
      );
      let decision;
      try {
        decision = await authorize(connection.principal, request.topic);
      } catch {
        decision = null;
      }
      if (!decision || !sub.lease.accept(attempt, decision?.validUntil)) {
        if (connection.closed || connection.topics.get(request.topic) !== sub)
          return;
        connection.topics.delete(request.topic);
        connection.socket.send({
          v: ENVELOPE_VERSION,
          type: 'error',
          id: request.id,
          code: 'AUTHORIZATION',
          message: 'Subscription refused',
        });
        return;
      }
      sub.revision = decision.revision;
      const through = cursor;
      if (request.since) {
        let result;
        try {
          result = await readCatchup(request.topic, request.since, through);
        } catch {
          result = { rows: [], resync: true };
        }
        if (connection.closed || connection.topics.get(request.topic) !== sub)
          return;
        if (
          !current(connection, request.topic, sub) ||
          result.resync ||
          compare(floor, through) > 0
        ) {
          connection.topics.delete(request.topic);
          sub.lease.invalidate();
          connection.socket.send({
            v: ENVELOPE_VERSION,
            type: 'resync_required',
            id: request.id,
            topic: request.topic,
          });
          return;
        }
        // History I/O may wait behind locks. Its earlier permission cannot
        // authorize replay: reread canonical facts before attaching or sending.
        const replayAttempt = sub.lease.begin(
          connection.principal.sessionId,
          sub.revision,
        );
        let replayDecision;
        try {
          replayDecision = await authorize(connection.principal, request.topic);
        } catch {
          replayDecision = null;
        }
        if (
          connection.closed ||
          connection.topics.get(request.topic) !== sub ||
          !sub.lease.owns(replayAttempt)
        )
          return;
        if (
          !replayDecision ||
          !sub.lease.accept(replayAttempt, replayDecision.validUntil)
        ) {
          detach(connection, request.topic, sub);
          connection.topics.delete(request.topic);
          connection.socket.send({
            v: ENVELOPE_VERSION,
            type: 'error',
            id: request.id,
            code: 'AUTHORIZATION',
            message: 'Subscription refused',
          });
          return;
        }
        sub.revision = replayDecision.revision;
        for (const row of result.rows)
          if (!sendRow(connection, request.topic, sub, row)) return;
      }
      if (!current(connection, request.topic, sub)) return;
      connection.socket.subscribe(nativeTopic(connection, request.topic));
      sub.attached = true;
      if (!request.since) sub.delivered = through;
      for (const row of ring)
        if (row.topic === request.topic && compare(row, through) > 0)
          if (!sendRow(connection, request.topic, sub, row)) return;
      connection.socket.send({
        v: ENVELOPE_VERSION,
        type: 'subscribed',
        id: request.id,
        topic: request.topic,
        position: encodeOutboxCursor(cursor),
      });
    },
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
      for (const row of rows) control(row);
      for (const row of rows) {
        if (!isPayloadDeliverableOnTopic(row.topic, row.payload)) continue;
        if (row.kind !== 'channel.changed' && row.kind !== 'room.changed')
          continue;
        for (const connection of connections) {
          const sub = connection.topics.get(row.topic);
          if (sub && !sub.attached) sub.lease.invalidate();
        }
      }
      const all = [...ring, ...rows];
      if (all.length > ringLimit) floor = all[all.length - ringLimit - 1]!;
      ring = all.slice(-ringLimit);
      const last = rows.at(-1);
      if (last) cursor = { txid: last.txid, seq: last.seq };
      pending = pending
        .catch(() => {})
        .then(async () => {
          for (const row of rows) await deliver(row);
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
