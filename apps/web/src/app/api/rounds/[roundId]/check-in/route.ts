import { processRoute } from '../../../../../server/process-app';
import { attendanceComposition } from '../../../../../features/attendance/composition';
type Params = Awaited<RouteContext<'/api/rounds/[roundId]/check-in'>['params']>;

export const runtime = 'nodejs';
export const POST = processRoute.withParams(
  attendanceComposition,
  (routes) =>
    (request, { roundId }: Params) =>
      routes.checkIn(request, roundId),
);
