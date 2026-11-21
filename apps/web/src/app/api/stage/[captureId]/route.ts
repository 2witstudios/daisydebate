import { processRouteWithParams } from '../../../../server/process-app';
type Params = Awaited<RouteContext<'/api/stage/[captureId]'>['params']>;

export const runtime = 'nodejs';
export const GET = processRouteWithParams<Params>(
  (routes) =>
    (request, { captureId }) =>
      routes.stage(request, captureId),
);
