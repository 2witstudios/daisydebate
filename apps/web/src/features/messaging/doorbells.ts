import { buildChannelTopic, buildUserInboxTopic } from '@daisy/protocol';
import { attachInvalidationTopic } from '../realtime/invalidation-topic';

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
      frame.topic === buildUserInboxTopic(input.actorId),
  });
}
