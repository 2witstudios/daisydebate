import { buildUserInboxTopic } from '@daisy/protocol';
import { attachInvalidationTopic } from '../realtime/invalidation-topic';

type Observer = Omit<
  Parameters<typeof attachInvalidationTopic>[0],
  'topic' | 'matches'
>;
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
