import { processRoute } from '../../../server/process-app';

export const runtime = 'nodejs';
export const POST = processRoute(
  (routes) => routes.contentModeration.report.POST,
);
