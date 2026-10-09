import type { OutboxPosition, OutboxRow } from '@daisy/db';
import type { ServerMessage } from '@daisy/protocol';
import type { createAuthorityLease } from './authority-lease';
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
export type Subscription = {
  readonly lease: ReturnType<typeof createAuthorityLease>;
  revision: string;
  attached: boolean;
  initializing: boolean;
  delivered: OutboxPosition;
};
export type Connection = {
  readonly socket: RegistrySocket;
  readonly principal: SocketPrincipal;
  readonly topics: Map<string, Subscription>;
  closed: boolean;
  readonly nativeId: number;
};
export type SubscribeRequest = {
  readonly id: string;
  readonly topic: string;
  readonly since?: string | undefined;
};
export type AuthorizeSubscription = (
  principal: SocketPrincipal,
  topic: string,
) => Promise<{ readonly revision: string; readonly validUntil: number } | null>;
export type SubscriptionTransport = {
  readonly detach: (
    connection: Connection,
    topic: string,
    subscription: Subscription,
  ) => void;
  readonly current: (
    connection: Connection,
    topic: string,
    subscription: Subscription,
  ) => boolean;
  readonly nativeTopic: (connection: Connection, topic: string) => string;
};
export type ReplayTransport = SubscriptionTransport & {
  readonly sendRow: (
    connection: Connection,
    topic: string,
    sub: Subscription,
    row: OutboxRow,
  ) => boolean;
  readonly resync: (
    connection: Connection,
    request: SubscribeRequest,
    sub: Subscription,
  ) => void;
};
export const compare = (a: OutboxPosition, b: OutboxPosition) =>
  BigInt(a.txid) < BigInt(b.txid)
    ? -1
    : BigInt(a.txid) > BigInt(b.txid)
      ? 1
      : a.seq < b.seq
        ? -1
        : a.seq > b.seq
          ? 1
          : 0;
export const ownsSubscription = (
  connection: Connection,
  topic: string,
  sub: Subscription,
) => !connection.closed && connection.topics.get(topic) === sub;
export async function readSubscriptionDecision(
  authorize: AuthorizeSubscription,
  connection: Connection,
  topic: string,
) {
  try {
    return await authorize(connection.principal, topic);
  } catch {
    return null;
  }
}
