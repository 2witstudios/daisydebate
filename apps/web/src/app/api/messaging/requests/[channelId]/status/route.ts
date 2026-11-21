import { processRoute } from '../../../../../../server/process-app';
type Params = Awaited<
  RouteContext<'/api/messaging/requests/[channelId]/status'>['params']
>;

export const GET = processRoute.withParams<Params>(
  (routes) =>
    (request, { channelId }) =>
      routes.messaging.requestStatus(request, channelId),
);
