import { processRoute } from '../../../../server/process-app';
import { moderationComposition } from '../../../../features/moderation/composition';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = processRoute(
  moderationComposition,
  (routes) => routes.notices,
);
export const POST = processRoute(
  moderationComposition,
  (routes) => routes.acknowledge,
);
