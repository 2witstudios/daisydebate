import { processRoute } from '../../../../../server/process-app';

type Params = Awaited<RouteContext<'/api/clubs/[club]/billing'>['params']>;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = processRoute.withParams<Params>(
  (routes) =>
    (request, { club }) =>
      routes.billing.clubs.billing.GET(request, club),
);
