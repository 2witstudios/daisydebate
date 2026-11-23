import { processRoute } from '../../../../../server/process-app';
import { clubComposition } from '../../../../../features/clubs/composition';

type Params = Awaited<RouteContext<'/api/clubs/[club]/seats'>['params']>;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = processRoute.withParams(
  clubComposition,
  (routes) =>
    (request, { club }: Params) =>
      routes.seats.GET(request, club),
);
export const POST = processRoute.withParams(
  clubComposition,
  (routes) =>
    (request, { club }: Params) =>
      routes.seats.POST(request, club),
);
