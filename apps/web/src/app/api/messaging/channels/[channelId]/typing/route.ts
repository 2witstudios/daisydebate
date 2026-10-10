import { processMessagingChannelRead } from '../../../../../../server/process-app';
export const runtime = 'nodejs';
export const GET = processMessagingChannelRead('typing');
