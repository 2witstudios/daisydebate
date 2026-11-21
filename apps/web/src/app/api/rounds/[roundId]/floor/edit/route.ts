import { processRouteWithParams } from '../../../../../../server/process-app';
type Params = Awaited<
  RouteContext<'/api/rounds/[roundId]/floor/edit'>['params']
>;

export const runtime = 'nodejs';
export const POST = processRouteWithParams<Params>(
  (routes) =>
    (request, { roundId }) =>
      routes.roundFloor.edit(request, roundId),
);
