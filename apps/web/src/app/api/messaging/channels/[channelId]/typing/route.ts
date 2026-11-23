import { processRoute } from '../../../../../../server/process-app';
import { messagingComposition } from '../../../../../../features/messaging/composition';
import { messagingChannelRead } from '../../../../../../features/messaging/channel-read-binding';
export const runtime = 'nodejs';
export const GET = messagingChannelRead(
  (pick) => processRoute(messagingComposition, pick),
  'typing',
);
