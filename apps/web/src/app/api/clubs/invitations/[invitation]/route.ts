import { processRoute } from '../../../../../server/process-app';

type Params = Awaited<
  RouteContext<'/api/clubs/invitations/[invitation]'>['params']
>;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = processRoute.withParams<Params>(
  (routes) =>
    (request, { invitation }) =>
      routes.billing.clubs.invitation.GET(request, invitation),
);
export const POST = processRoute.withParams<Params>(
  (routes) =>
    (request, { invitation }) =>
      routes.billing.clubs.invitation.POST(request, invitation),
);
