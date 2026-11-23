import { processRoute } from '../../../../../../server/process-app';
import { messagingComposition } from '../../../../../../features/messaging/composition';
import { messagingChannelRead } from '../../../../../../server/messaging-channel-binding';
export const runtime = 'nodejs';
export const GET = messagingChannelRead(
  (pick) => processRoute(messagingComposition, pick),
  'typing',
);
