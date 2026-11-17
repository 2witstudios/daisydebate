import { processRoute } from '../../../../server/process-app';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = processRoute((routes) => routes.publicProfile.uploadPhoto);
export const DELETE = processRoute(
  (routes) => routes.publicProfile.withdrawPhoto,
);
