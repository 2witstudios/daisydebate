import { processRoute } from '../../../../../server/process-app';
type Params = Awaited<RouteContext<'/api/rounds/[roundId]/media'>['params']>;

export const runtime = 'nodejs';
export const GET = processRoute.withParams<Params>(
  (routes) =>
    (request, { roundId }) =>
      routes.roundMedia.read(request, roundId),
);
