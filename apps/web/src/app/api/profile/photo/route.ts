import { processRoute } from '../../../../server/process-app';
import { publicProfileComposition } from '../../../../features/profile/public-profile-routes';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = processRoute(
  publicProfileComposition,
  (routes) => routes.uploadPhoto,
);
export const DELETE = processRoute(
  publicProfileComposition,
  (routes) => routes.withdrawPhoto,
);
