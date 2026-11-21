import { processRoute } from '../../../../../server/process-app';
type Params = Awaited<RouteContext<'/api/rounds/[roundId]/floor'>['params']>;

export const runtime = 'nodejs';
export const GET = processRoute.withParams<Params>(
  (routes) =>
    (request, { roundId }) =>
      routes.roundFloor.discover(request, roundId),
);
export const POST = processRoute.withParams<Params>(
  (routes) =>
    (request, { roundId }) =>
      routes.roundFloor.open(request, roundId),
);
