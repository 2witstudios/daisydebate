import type { ServerMessage } from '@daisy/protocol';
import type { ConnectionStore } from '../realtime/connection-store';
import { attachInvalidationTopic } from '../realtime/invalidation-topic';

type Versioned =
  'room.changed' | 'debate.phase-changed' | 'debate.transcript-changed';

/**
 * A resource's content-free doorbell as sync signals: the announced version,
 * or null after a resync or a connection error. The held value stays on
 * screen until a read answers.
 */
export function attachVersionDoorbell({
  topic,
  kind,
  id,
  connection,
  signal,
  catchUpOnSubscribe,
}: {
  readonly topic: string;
  readonly kind: Versioned;
  /** The resource the doorbell must name. */
  readonly id: string;
  readonly connection: Pick<
    ConnectionStore,
    'subscribeTopic' | 'onMessage' | 'resubscribeTopic'
  >;
  readonly signal: (version: number | null) => void;
  readonly catchUpOnSubscribe?: boolean;
}) {
  const rings = (frame: ServerMessage | null) =>
    frame?.type === 'event' &&
    frame.topic === topic &&
    frame.payload.kind === kind &&
    'ids' in frame.payload &&
    frame.payload.ids.includes(id) &&
    'entityVersion' in frame.payload
      ? frame.payload.entityVersion
      : null;
  return attachInvalidationTopic({
    topic,
    connection,
    matches: (frame) => rings(frame) !== null,
    ...(catchUpOnSubscribe ? { catchUpOnSubscribe } : {}),
    invalidate: () => {},
    refetch: (frame) => signal(rings(frame)),
  });
}
