import { processRoute } from '../../../server/process-app';
import { contentModerationComposition } from '../../../features/content-moderation/composition';

export const runtime = 'nodejs';
export const POST = processRoute(
  contentModerationComposition,
  (routes) => routes.report.POST,
);
