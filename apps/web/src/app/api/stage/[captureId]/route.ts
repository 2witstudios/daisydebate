import { processRoute } from '../../../../server/process-app';
type Params = Awaited<RouteContext<'/api/stage/[captureId]'>['params']>;

export const runtime = 'nodejs';
export const GET = processRoute.withParams<Params>(
  (routes) =>
    (request, { captureId }) =>
      routes.stage(request, captureId),
);
