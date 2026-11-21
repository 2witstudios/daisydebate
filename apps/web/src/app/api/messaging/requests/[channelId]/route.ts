import { processRoute } from '../../../../../server/process-app';
type Params = Awaited<
  RouteContext<'/api/messaging/requests/[channelId]'>['params']
>;

export const runtime = 'nodejs';
export const GET = processRoute.withParams<Params>(
  (routes) =>
    (request, { channelId }) =>
      routes.messaging.requestPreview(request, channelId),
);
