import { processRoute } from '../../../../server/process-app';
import { audienceComposition } from '../../../../features/spectating/audience-composition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = processRoute(
  audienceComposition,
  (routes) => routes.notificationShell,
);
