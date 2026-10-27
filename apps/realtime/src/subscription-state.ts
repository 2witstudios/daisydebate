import type { OutboxPosition, OutboxRow } from '@daisy/db/outbox';
import { ENVELOPE_VERSION, type ServerMessage } from '@daisy/protocol';
import type { createAuthorityLease } from './authority-lease';
export type SocketPrincipal = {
  readonly actorId: string;
  readonly userId: string;
  readonly sessionId: string;
};
export type RegistrySocket = {
  readonly bufferedAmount: () => number;
  readonly send: (frame: ServerMessage) => void;
  readonly subscribe: (topic: string) => void;
  readonly unsubscribe: (topic: string) => void;
  readonly close: (code: number, reason: string) => void;
};
export type Subscription = {
  /** The subscribe request this answers; a later resync names it. */
  readonly requestId: string;
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
  readonly resync: (
    connection: Connection,
    request: Pick<SubscribeRequest, 'id' | 'topic'>,
    sub: Subscription,
  ) => void;
};
export type ReplayTransport = SubscriptionTransport & {
  readonly sendRow: (
    connection: Connection,
    topic: string,
    sub: Subscription,
    row: OutboxRow,
  ) => boolean;
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
const refusalMessages = {
  RATE_LIMIT: 'Subscription limit reached',
  AUTHORIZATION: 'Subscription refused',
  INFRASTRUCTURE: 'Subscription authority unavailable',
} as const;
/** A subscribe refusal names its cause; only INFRASTRUCTURE is transient. */
export const subscriptionRefusal = (
  id: string,
  code: keyof typeof refusalMessages,
) => ({
  v: ENVELOPE_VERSION,
  type: 'error' as const,
  id,
  code,
  message: refusalMessages[code],
});
/** An authority read that could not decide: transient, never a denial. */
export const AUTHORITY_UNAVAILABLE = 'unavailable';
/** Allowed, denied (null), or unavailable after a reported failure of the read itself. */
export async function readSubscriptionDecision(
  authorize: AuthorizeSubscription,
  connection: Connection,
  topic: string,
  failed: (error: unknown) => void,
) {
  try {
    return await authorize(connection.principal, topic);
  } catch (error) {
    failed(error);
    return AUTHORITY_UNAVAILABLE;
  }
}
