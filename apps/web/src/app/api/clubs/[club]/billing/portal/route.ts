import { processRoute } from '../../../../../../server/process-app';
import { clubComposition } from '../../../../../../features/clubs/composition';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = processRoute(
  clubComposition,
  (routes) => routes.billing.portal,
);
