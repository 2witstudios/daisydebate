import {
  OUTBOX_ORIGIN,
  decodeOutboxCursor,
  encodeOutboxCursor,
  type OutboxPosition,
  type OutboxRow,
} from '@daisy/db';
import { ENVELOPE_VERSION } from '@daisy/protocol';
import { createAuthorityLease } from './authority-lease';
import {
  compare,
  ownsSubscription,
  readSubscriptionDecision,
  type AuthorizeSubscription,
  type Connection,
  type Subscription,
  type SubscribeRequest,
  type ReplayTransport,
} from './subscription-state';

type Snapshot = {
  readonly cursor: OutboxPosition;
  readonly floor: OutboxPosition;
  readonly ring: readonly OutboxRow[];
};
type History = {
  readonly rows: readonly OutboxRow[];
  readonly resync: boolean;
};
export function createSubscriptionReceiver({
  now,
  lifetimeMs,
  maxSubscriptions,
  authorize,
  readCatchup,
  readRetentionBoundary,
  snapshot,
  transport,
}: {
  readonly now: () => number;
  readonly lifetimeMs: number;
  readonly maxSubscriptions: number;
  readonly authorize: AuthorizeSubscription;
  readonly readCatchup: (
    topic: string,
    since: string,
    through: OutboxPosition,
  ) => Promise<History>;
  readonly readRetentionBoundary: () => Promise<OutboxPosition | null>;
  readonly snapshot: () => Snapshot;
  readonly transport: ReplayTransport;
}) {
  function refuse(
    connection: Connection,
    request: SubscribeRequest,
    code: 'RATE_LIMIT' | 'AUTHORIZATION',
  ) {
    connection.topics.delete(request.topic);
    connection.socket.send({
      v: ENVELOPE_VERSION,
      type: 'error',
      id: request.id,
      code,
      message:
        code === 'RATE_LIMIT'
          ? 'Subscription limit reached'
          : 'Subscription refused',
    });
  }
  function reserve(
    connection: Connection,
    request: SubscribeRequest,
  ): Subscription | null {
    if (connection.closed) return null;
    const old = connection.topics.get(request.topic);
    if (old) transport.detach(connection, request.topic, old);
    else if (connection.topics.size >= maxSubscriptions) {
      // A limit refusal must not remove an existing unrelated subscription.
      connection.socket.send({
        v: ENVELOPE_VERSION,
        type: 'error',
        id: request.id,
        code: 'RATE_LIMIT',
        message: 'Subscription limit reached',
      });
      return null;
    }
    const sub: Subscription = {
      lease: createAuthorityLease({ now, lifetimeMs }),
      revision: '',
      attached: false,
      initializing: true,
      delivered: OUTBOX_ORIGIN,
    };
    connection.topics.set(request.topic, sub);
    return sub;
  }
  function beginAuthority(
    connection: Connection,
    topic: string,
    sub: Subscription,
  ) {
    // Begin synchronously: extracting this seam must add no await before the caller fence.
    const attempt = sub.lease.begin(
      connection.principal.sessionId,
      sub.revision,
    );
    return {
      attempt,
      decision: readSubscriptionDecision(authorize, connection, topic),
    };
  }
  async function initialAuthority(
    connection: Connection,
    request: SubscribeRequest,
    sub: Subscription,
  ) {
    const { attempt, decision: pending } = beginAuthority(
      connection,
      request.topic,
      sub,
    );
    const decision = await pending;
    if (!ownsSubscription(connection, request.topic, sub)) return false;
    if (!decision || !sub.lease.accept(attempt, decision?.validUntil)) {
      refuse(connection, request, 'AUTHORIZATION');
      return false;
    }
    sub.revision = decision.revision;
    return true;
  }
  async function history(
    topic: string,
    since: string,
    through: OutboxPosition,
  ): Promise<History> {
    // The observed ring alone never certifies completeness after pruning.
    try {
      return await readCatchup(topic, since, through);
    } catch {
      return { rows: [], resync: true };
    }
  }
  function resyncIf(
    connection: Connection,
    request: SubscribeRequest,
    sub: Subscription,
    refused: boolean,
  ) {
    if (refused) transport.resync(connection, request, sub);
    return refused;
  }
  async function finalBoundary(since: string, through: OutboxPosition) {
    const boundaryThrough = snapshot().cursor;
    let boundary: OutboxPosition | null;
    try {
      boundary = await readRetentionBoundary();
    } catch {
      boundary = null;
    }
    return () => {
      const current = snapshot();
      return (
        boundary !== null &&
        compare(decodeOutboxCursor(since), boundary) >= 0 &&
        compare(current.cursor, boundaryThrough) === 0 &&
        compare(current.floor, through) <= 0
      );
    };
  }

  async function replayAuthority(
    connection: Connection,
    request: SubscribeRequest,
    sub: Subscription,
    through: OutboxPosition,
    since: string,
  ) {
    // History/lock waits cannot carry their earlier allow into attachment.
    const { attempt, decision: pending } = beginAuthority(
      connection,
      request.topic,
      sub,
    );
    const decision = await pending;
    if (!ownsSubscription(connection, request.topic, sub)) return false;
    if (
      resyncIf(
        connection,
        request,
        sub,
        !sub.lease.owns(attempt) || compare(snapshot().floor, through) > 0,
      )
    )
      return false;
    if (!decision) {
      transport.detach(connection, request.topic, sub);
      refuse(connection, request, 'AUTHORIZATION');
      return false;
    }
    const certified = await finalBoundary(since, through);
    return () => {
      if (!ownsSubscription(connection, request.topic, sub)) return false;
      if (
        resyncIf(
          connection,
          request,
          sub,
          !certified() || !sub.lease.owns(attempt),
        )
      )
        return false;
      if (
        resyncIf(
          connection,
          request,
          sub,
          !sub.lease.accept(attempt, decision.validUntil),
        )
      )
        return false;
      sub.revision = decision.revision;
      return true;
    };
  }

  async function replay(
    connection: Connection,
    request: SubscribeRequest,
    sub: Subscription,
    through: OutboxPosition,
    since: string,
  ) {
    const result = await history(request.topic, since, through);
    if (!ownsSubscription(connection, request.topic, sub)) return false;
    if (
      resyncIf(
        connection,
        request,
        sub,
        result.resync || compare(snapshot().floor, through) > 0,
      )
    )
      return false;
    const accept = await replayAuthority(
      connection,
      request,
      sub,
      through,
      since,
    );
    return () => {
      if (!accept || !accept()) return false;
      for (const row of result.rows)
        if (!transport.sendRow(connection, request.topic, sub, row))
          return false;
      return true;
    };
  }

  function attach(
    connection: Connection,
    request: SubscribeRequest,
    sub: Subscription,
    through: OutboxPosition,
  ) {
    if (!transport.current(connection, request.topic, sub)) {
      if (ownsSubscription(connection, request.topic, sub))
        transport.resync(connection, request, sub);
      return;
    }
    connection.socket.subscribe(
      transport.nativeTopic(connection, request.topic),
    );
    sub.attached = true;
    sub.initializing = false;
    if (!request.since) sub.delivered = through;
    for (const row of snapshot().ring)
      if (row.topic === request.topic && compare(row, through) > 0)
        if (!transport.sendRow(connection, request.topic, sub, row)) return;
    connection.socket.send({
      v: ENVELOPE_VERSION,
      type: 'subscribed',
      id: request.id,
      topic: request.topic,
      position: encodeOutboxCursor(snapshot().cursor),
    });
  }
  return async (connection: Connection, request: SubscribeRequest) => {
    const sub = reserve(connection, request);
    if (!sub || !(await initialAuthority(connection, request, sub))) return;
    const through = snapshot().cursor;
    if (request.since) {
      const accept = await replay(
        connection,
        request,
        sub,
        through,
        request.since,
      );
      if (!accept || !accept()) return;
    }
    // No await between the final guards, history/ring replay and native attach.
    attach(connection, request, sub, through);
  };
}
