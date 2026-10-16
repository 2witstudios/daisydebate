import type { ServerMessage } from '@daisy/protocol';
import type { ConnectionStore } from './connection-store';

/** Doorbells invalidate a snapshot; they never carry content or authority. */
export function attachInvalidationTopic({
  topic,
  matches,
  connection,
  invalidate,
  refetch,
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
}) {
  let resync = false;
  const refresh = (frame: ServerMessage | null) => {
    invalidate();
    refetch(frame);
  };
  const unsubscribe = connection.subscribeTopic(topic, (frame) => {
    if (frame.type === 'resync_required') {
      resync = true;
      refresh(frame);
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
