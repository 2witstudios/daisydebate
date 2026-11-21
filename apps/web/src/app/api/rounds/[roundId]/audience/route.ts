import { processRouteWithParams } from '../../../../../server/process-app';

type Params = Awaited<RouteContext<'/api/rounds/[roundId]/audience'>['params']>;

export const runtime = 'nodejs';
export const GET = processRouteWithParams<Params>(
  (routes) =>
    (request, { roundId }) =>
      routes.audience.snapshot(request, roundId),
);
