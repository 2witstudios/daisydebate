import { processRoute } from '../../../server/process-app';
import { confirmEmailComposition } from '../../../features/auth/composition';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = processRoute(
  confirmEmailComposition,
  (routes) => routes.GET,
);
export const HEAD = processRoute(
  confirmEmailComposition,
  (routes) => routes.HEAD,
);
export const POST = processRoute(
  confirmEmailComposition,
  (routes) => routes.POST,
);
