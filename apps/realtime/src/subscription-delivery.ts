import type { OutboxRow } from '@daisy/db';
import {
  isPayloadDeliverableOnTopic,
  isPayloadStorableOnTopic,
  outboxPayloadSchema,
  serverMessageSchema,
  type ServerMessage,
} from '@daisy/protocol';
import {
  compare,
  ownsSubscription,
  readSubscriptionDecision,
  type AuthorizeSubscription,
  type Connection,
  type SocketPrincipal,
  type Subscription,
  type SubscriptionTransport,
} from './subscription-state';

export function createSubscriptionDelivery({
  connections,
  authorize,
  publish,
  event,
  transport,
  remove,
}: {
  readonly connections: Set<Connection>;
  readonly authorize: AuthorizeSubscription;
  readonly publish: (topic: string, frame: ServerMessage) => void;
  readonly event: (row: OutboxRow) => ServerMessage;
  readonly transport: SubscriptionTransport;
  readonly remove: (connection: Connection) => void;
}) {
  const hints = new Map<string, Promise<void>>();
  type TypingHint = Extract<ServerMessage, { type: 'typing_changed' }>;
  function revoke(connection: Connection) {
    remove(connection);
    connection.socket.close(4002, 'revoked');
  }
  function revokeAccess(connection: Connection, id: string | undefined) {
    for (const [topic, sub] of connection.topics) {
      if (topic.split(':')[1] !== id) continue;
      transport.detach(connection, topic, sub);
      connection.topics.delete(topic);
    }
  }
  function applyControl(
    connection: Connection,
    payload: Extract<
      ReturnType<typeof outboxPayloadSchema.parse>,
      { kind: 'session.revoked' | 'access.revoked' }
    >,
  ) {
    if (connection.principal.actorId !== payload.ids[0]) return;
    if (payload.kind === 'access.revoked')
      revokeAccess(connection, payload.ids[1]);
    if (payload.kind !== 'session.revoked') return;
    if (payload.ids[1] && payload.ids[1] !== connection.principal.sessionId)
      return;
    revoke(connection);
  }
  function control(row: OutboxRow) {
    if (!isPayloadStorableOnTopic(row.topic, row.payload)) return;
    const parsed = outboxPayloadSchema.safeParse(row.payload);
    if (!parsed.success) return;
    if (
      parsed.data.kind !== 'session.revoked' &&
      parsed.data.kind !== 'access.revoked'
    )
      return;
    for (const connection of connections) applyControl(connection, parsed.data);
  }
  async function refresh(
    connection: Connection,
    topic: string,
    sub: Subscription,
  ) {
    const attempt = sub.lease.begin(
      connection.principal.sessionId,
      sub.revision,
    );
    const decision = await readSubscriptionDecision(
      authorize,
      connection,
      topic,
    );
    if (!ownsSubscription(connection, topic, sub) || !sub.lease.owns(attempt))
      return 'superseded' as const;
    if (!decision || !sub.lease.accept(attempt, decision.validUntil)) {
      transport.detach(connection, topic, sub);
      return 'denied' as const;
    }
    sub.revision = decision.revision;
    return 'allowed' as const;
  }
  function publishRow(
    connection: Connection,
    row: OutboxRow,
    sub: Subscription,
  ) {
    if (!transport.current(connection, row.topic, sub)) {
      transport.detach(connection, row.topic, sub);
      return;
    }
    if (compare(row, sub.delivered) <= 0) return;
    if (publishFrame(connection, row.topic, sub, () => event(row)))
      sub.delivered = row;
  }
  function publishFrame(
    connection: Connection,
    topic: string,
    sub: Subscription,
    frame: () => ServerMessage,
  ) {
    if (!transport.current(connection, topic, sub)) {
      transport.detach(connection, topic, sub);
      return false;
    }
    try {
      publish(transport.nativeTopic(connection, topic), frame());
      if (connection.socket.bufferedAmount() > 262_144)
        throw new Error('Realtime recipient exceeded the soft buffer bound');
      return true;
    } catch {
      remove(connection);
      connection.socket.close(4005, 'slow_consumer');
      return false;
    }
  }
  async function deliverHintTo(connection: Connection, frame: TypingHint) {
    const sub = connection.topics.get(frame.topic);
    if (!sub?.attached || sub.initializing) return;
    const outcome = await refresh(connection, frame.topic, sub);
    if (outcome === 'denied' && ownsSubscription(connection, frame.topic, sub))
      connection.topics.delete(frame.topic);
    if (outcome === 'allowed')
      publishFrame(connection, frame.topic, sub, () => frame);
  }
  function hint(frame: unknown): Promise<void> {
    const parsed = serverMessageSchema.safeParse(frame, { jitless: true });
    if (!parsed.success || parsed.data.type !== 'typing_changed')
      return Promise.resolve();
    const validated = parsed.data;
    const busy = hints.get(validated.topic);
    if (busy) return busy;
    const recipients = [...connections].filter(
      (connection) => connection.topics.get(validated.topic)?.attached,
    );
    if (recipients.length === 0) return Promise.resolve();
    const delivery = Promise.allSettled(
      recipients.map((connection) => deliverHintTo(connection, validated)),
    )
      .then(() => {})
      .finally(() => {
        hints.delete(validated.topic);
      });
    hints.set(validated.topic, delivery);
    return delivery;
  }

  async function deliverTo(connection: Connection, row: OutboxRow) {
    const sub = connection.topics.get(row.topic);
    if (!sub?.attached) return;
    if ((await refresh(connection, row.topic, sub)) !== 'allowed') return;
    // The current lease is checked after the final await, immediately before publish.
    publishRow(connection, row, sub);
  }
  async function revalidateTopic(
    connection: Connection,
    topic: string,
    sub: Subscription,
  ) {
    if (sub.initializing) return;
    if (!sub.lease.current()) transport.detach(connection, topic, sub);
    const outcome = await refresh(connection, topic, sub);
    if (outcome === 'superseded') return;
    if (outcome === 'denied') {
      if (ownsSubscription(connection, topic, sub))
        connection.topics.delete(topic);
      return;
    }
    if (!transport.current(connection, topic, sub)) return;
    if (!sub.attached) {
      connection.socket.subscribe(transport.nativeTopic(connection, topic));
      sub.attached = true;
    }
  }
  async function principalValid(
    connection: Connection,
    validate: (principal: SocketPrincipal) => Promise<boolean>,
  ) {
    try {
      return await validate(connection.principal);
    } catch {
      return false;
    }
  }
  async function revalidateConnection(
    connection: Connection,
    validate: (principal: SocketPrincipal) => Promise<boolean>,
  ) {
    const valid = await principalValid(connection, validate);
    if (connection.closed) return;
    if (!valid) {
      revoke(connection);
      return;
    }
    await Promise.all(
      [...connection.topics].map(([topic, sub]) =>
        revalidateTopic(connection, topic, sub),
      ),
    );
  }
  function invalidateRow(row: OutboxRow) {
    control(row);
    if (!isPayloadDeliverableOnTopic(row.topic, row.payload)) return;
    for (const connection of connections) {
      const sub = connection.topics.get(row.topic);
      if (!sub) continue;
      if (sub.attached && sub.lease.expired())
        transport.detach(connection, row.topic, sub);
      else sub.lease.invalidate();
    }
  }
  return {
    hint,
    async settledHints() {
      await Promise.allSettled([...hints.values()]);
    },
    invalidate: (rows: readonly OutboxRow[]) => {
      for (const row of rows) invalidateRow(row);
    },
    async deliver(row: OutboxRow) {
      if (!isPayloadDeliverableOnTopic(row.topic, row.payload)) return;
      for (const connection of connections) await deliverTo(connection, row);
    },
    async revalidate(
      validate: (principal: SocketPrincipal) => Promise<boolean>,
    ) {
      await Promise.all(
        [...connections].map((connection) =>
          revalidateConnection(connection, validate),
        ),
      );
    },
  };
}
