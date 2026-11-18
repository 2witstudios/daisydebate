import { processRoute } from '../../../../../server/process-app';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = processRoute(
  (routes) => routes.billing.clubs.invitation.GET,
);
export const POST = processRoute(
  (routes) => routes.billing.clubs.invitation.POST,
);
