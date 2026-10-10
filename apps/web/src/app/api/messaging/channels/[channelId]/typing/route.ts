import { processRoute } from '../../../../../../server/process-app';
import { messagingChannelRead } from '../../../../../../server/messaging-channel-binding';
export const runtime = 'nodejs';
export const GET = messagingChannelRead(processRoute, 'typing');
