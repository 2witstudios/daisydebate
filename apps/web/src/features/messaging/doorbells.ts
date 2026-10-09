import {
  buildChannelTopic,
  buildUserInboxTopic,
  type ServerMessage,
} from '@daisy/protocol';
import type { ConnectionStore } from '../realtime/connection-store';

/** Doorbells invalidate a snapshot; they never carry content or authority. */
function attachInvalidationTopic({
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
  readonly refetch: () => void;
}) {
  let resync = false;
  const refresh = () => {
    invalidate();
    refetch();
  };
  const unsubscribe = connection.subscribeTopic(topic, (frame) => {
    if (frame.type === 'resync_required') {
      resync = true;
      refresh();
    } else if (matches(frame)) refresh();
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

type Observer = Omit<
  Parameters<typeof attachInvalidationTopic>[0],
  'topic' | 'matches'
>;
export function attachMessagingDoorbells(
  input: Observer & { readonly channelId: string },
) {
  return attachInvalidationTopic({
    ...input,
    topic: buildChannelTopic(input.channelId),
    matches: (frame) =>
      frame.type === 'event' &&
      frame.payload.kind === 'channel.changed' &&
      frame.payload.channelId === input.channelId,
  });
}
export function attachMessagingInboxDoorbells(
  input: Observer & { readonly actorId: string },
) {
  return attachInvalidationTopic({
    ...input,
    topic: buildUserInboxTopic(input.actorId),
    matches: (frame) =>
      frame.type === 'event' &&
      frame.payload.kind === 'messaging.inbox.changed' &&
      frame.payload.actorId === input.actorId,
  });
}
