import { processRoute } from '../../../../../server/process-app';
type Params = Awaited<RouteContext<'/api/rounds/[roundId]/check-in'>['params']>;

export const runtime = 'nodejs';
export const POST = processRoute.withParams<Params>(
  (routes) =>
    (request, { roundId }) =>
      routes.attendance.checkIn(request, roundId),
);
