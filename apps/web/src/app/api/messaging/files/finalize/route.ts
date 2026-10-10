import { processRoute } from '../../../../../server/process-app';
export const runtime = 'nodejs';
export const POST = processRoute((routes) => routes.messaging.files.finalize);
