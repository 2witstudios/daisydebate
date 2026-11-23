import { processRoute } from '../../../../../server/process-app';
import { revokeSessionComposition } from '../../../../../features/account/composition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = processRoute(
  revokeSessionComposition,
  (routes) => routes.POST,
);
