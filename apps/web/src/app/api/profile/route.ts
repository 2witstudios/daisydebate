import { processRoute } from '../../../server/process-app';
import { publicProfileComposition } from '../../../features/profile/public-profile-routes';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = processRoute(
  publicProfileComposition,
  (routes) => routes.read,
);
export const PUT = processRoute(
  publicProfileComposition,
  (routes) => routes.write,
);
