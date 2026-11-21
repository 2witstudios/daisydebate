import { processRoute } from '../../../../../../server/process-app';
type Params = Awaited<
  RouteContext<'/api/rounds/[roundId]/floor/messages'>['params']
>;

export const runtime = 'nodejs';
export const GET = processRoute.withParams<Params>(
  (routes) =>
    (request, { roundId }) =>
      routes.roundFloor.history(request, roundId),
);
export const POST = processRoute.withParams<Params>(
  (routes) =>
    (request, { roundId }) =>
      routes.roundFloor.send(request, roundId),
);
