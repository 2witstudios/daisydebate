import { buildChannelTopic } from '@daisy/protocol';
import type { ConnectionStore } from '../realtime/connection-store';

/** Doorbells invalidate a snapshot; they never carry content or authority. */
export function attachMessagingDoorbells({
  channelId,
  connection,
  invalidate,
  refetch,
}: {
  readonly channelId: string;
  readonly connection: Pick<
    ConnectionStore,
    'subscribeTopic' | 'onMessage' | 'resubscribeTopic'
  >;
  readonly invalidate: () => void;
  readonly refetch: () => void;
}) {
  const topic = buildChannelTopic(channelId);
  let resync = false;
  const refresh = () => {
    invalidate();
    refetch();
  };
  const unsubscribe = connection.subscribeTopic(topic, (frame) => {
    if (frame.type === 'resync_required') {
      resync = true;
      refresh();
    } else if (
      frame.type === 'event' &&
      frame.payload.kind === 'channel.changed' &&
      frame.payload.channelId === channelId
    )
      refresh();
  });
  const stopErrors = connection.onMessage((frame) => {
    if (frame.type === 'error') refresh();
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
