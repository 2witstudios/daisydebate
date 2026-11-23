import { processRoute } from '../../../../server/process-app';
import { audienceComposition } from '../../../../features/spectating/audience-composition';

export const runtime = 'nodejs';
export const POST = processRoute(
  audienceComposition,
  (routes) => routes.notificationPresentation,
);
