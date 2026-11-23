import { processRoute } from '../../../../../server/process-app';
import { clubComposition } from '../../../../../features/clubs/composition';

type Params = Awaited<RouteContext<'/api/clubs/[club]/billing'>['params']>;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = processRoute.withParams(
  clubComposition,
  (routes) =>
    (request, { club }: Params) =>
      routes.billing.GET(request, club),
);
