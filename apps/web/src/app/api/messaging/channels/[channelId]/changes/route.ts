import { processRouteWithParams } from '../../../../../../server/process-app';
type Params = Awaited<
  RouteContext<'/api/messaging/channels/[channelId]/changes'>['params']
>;

export const runtime = 'nodejs';
export const GET = processRouteWithParams<Params>(
  (routes) =>
    (request, { channelId }) =>
      routes.messaging.changes(request, channelId),
);
