import { processRouteWithParams } from '../../../../../server/process-app';
type Params = Awaited<RouteContext<'/api/rounds/[roundId]/check-in'>['params']>;

export const runtime = 'nodejs';
export const POST = processRouteWithParams<Params>(
  (routes) =>
    (request, { roundId }) =>
      routes.attendance.checkIn(request, roundId),
);
