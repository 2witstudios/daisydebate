import type { ServerMessage } from '@daisy/protocol';
import type { ConnectionStore } from './connection-store';

/** Transient refusals in a row retried before the topic waits for a reconnect. */
const MAX_REFUSAL_RETRIES = 3;

/** Doorbells invalidate a snapshot; they never carry content or authority. */
export function attachInvalidationTopic({
  topic,
  matches,
  connection,
  invalidate,
  refetch,
  catchUpOnSubscribe = false,
}: {
  readonly topic: string;
  readonly matches: (frame: ServerMessage) => boolean;
  readonly connection: Pick<
    ConnectionStore,
    'subscribeTopic' | 'onMessage' | 'resubscribeTopic'
  >;
  readonly invalidate: () => void;
  /** The frame that rang, or null when the connection reported an error. */
  readonly refetch: (frame: ServerMessage | null) => void;
  readonly catchUpOnSubscribe?: boolean;
}) {
  let resync = false;
  let refusals = 0;
  const refresh = (frame: ServerMessage | null) => {
    invalidate();
    refetch(frame);
  };
  const unsubscribe = connection.subscribeTopic(topic, (frame) => {
    if (frame.type === 'resync_required') {
      resync = true;
      refresh(frame);
    } else if (frame.type === 'subscribed') {
      refusals = 0;
      if (catchUpOnSubscribe) refresh(null);
    } else if (frame.type === 'error' && frame.code === 'INFRASTRUCTURE') {
      // The server could not decide authority for now; the read this error
      // triggers proves authority again, then the topic resubscribes. Any
      // other refusal (AUTHORIZATION, RATE_LIMIT) is final for this socket.
      if (refusals < MAX_REFUSAL_RETRIES) {
        refusals += 1;
        resync = true;
      }
    } else if (matches(frame)) refresh(frame);
  });
  const stopErrors = connection.onMessage((frame) => {
    if (frame.type === 'error') refresh(null);
  });
  return {
    authorizedSnapshot() {
      if (resync) {
        resync = false;
        connection.resubscribeTopic(topic);
      }
    },
    close() {
      unsubscribe();
      stopErrors();
    },
  };
}
