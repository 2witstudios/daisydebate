import { processRoute } from '../../../../../../server/process-app';

type Params = Awaited<
  RouteContext<'/api/clubs/[club]/billing/portal'>['params']
>;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = processRoute.withParams<Params>(
  (routes) =>
    (request, { club }) =>
      routes.billing.clubs.billing.portal(request, club),
);
