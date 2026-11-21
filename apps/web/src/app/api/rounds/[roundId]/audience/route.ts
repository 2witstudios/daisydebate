import { processRoute } from '../../../../../server/process-app';

type Params = Awaited<RouteContext<'/api/rounds/[roundId]/audience'>['params']>;

export const runtime = 'nodejs';
export const GET = processRoute.withParams<Params>(
  (routes) =>
    (request, { roundId }) =>
      routes.audience.snapshot(request, roundId),
);
