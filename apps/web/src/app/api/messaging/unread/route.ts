import { processRoute } from '../../../../server/process-app';

export const dynamic = 'force-dynamic';
export const GET = processRoute((routes) => routes.messaging.unread);
