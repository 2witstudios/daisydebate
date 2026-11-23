import { processRoute } from '../../../../../server/process-app';
import { clubComposition } from '../../../../../features/clubs/composition';

type Params = Awaited<
  RouteContext<'/api/clubs/invitations/[invitation]'>['params']
>;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = processRoute.withParams(
  clubComposition,
  (routes) =>
    (request, { invitation }: Params) =>
      routes.invitation.GET(request, invitation),
);
export const POST = processRoute.withParams(
  clubComposition,
  (routes) =>
    (request, { invitation }: Params) =>
      routes.invitation.POST(request, invitation),
);
