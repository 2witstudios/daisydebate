import { processRoute } from '../../../../../../../server/process-app';

type Params = Awaited<
  RouteContext<'/api/internal/media/[roundId]/capture/[operation]'>['params']
>;

export const runtime = 'nodejs';
export const POST = processRoute.withParams<Params>(
  (routes) =>
    (request, { operation }) =>
      routes.mediaCapture.handle(request, operation),
);
