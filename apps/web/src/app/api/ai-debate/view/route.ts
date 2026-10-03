import { processRoute } from '../../../../server/process-app';

export const runtime = 'nodejs';

export const GET = processRoute((routes) => routes.aiDebate.view.GET);
