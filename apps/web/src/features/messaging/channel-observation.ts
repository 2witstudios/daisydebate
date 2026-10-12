import {
  createObservationChannelBody,
  type MessagingCoreBounds,
} from '@daisy/protocol';
import type { RealtimeDescriptor } from '../realtime/observation-provider';

type ChannelBody = ReturnType<
  ReturnType<typeof createObservationChannelBody>['bodySchema']['parse']
>;
/** Live window of one conversation: the newest page, or the page before a
 * history position. The body mapper is the one realtime builds with. */
export function channelMessages(
  channelId: string,
  bounds: MessagingCoreBounds,
  before: number | null = null,
): RealtimeDescriptor<ChannelBody> {
  const { bodySchema } = createObservationChannelBody(bounds);
  return {
    resource: { kind: 'channel', id: channelId },
    window: { after: before, limit: Math.min(50, bounds.pageItems) },
    schema: 'channel-messages-v1',
    decode: (body) => {
      const parsed = bodySchema.safeParse(body);
      return parsed.success &&
        parsed.data.messages.every((message) => message.channelId === channelId)
        ? parsed.data
        : null;
    },
  };
}
