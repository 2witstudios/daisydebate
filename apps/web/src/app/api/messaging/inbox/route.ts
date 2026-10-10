import { processRoute } from '../../../../server/process-app';
export const GET = processRoute((routes) => routes.messaging.inbox);
