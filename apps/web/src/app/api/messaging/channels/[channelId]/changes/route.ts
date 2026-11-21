import { processRoute } from '../../../../../../server/process-app';
type Params = Awaited<
  RouteContext<'/api/messaging/channels/[channelId]/changes'>['params']
>;

export const runtime = 'nodejs';
export const GET = processRoute.withParams<Params>(
  (routes) =>
    (request, { channelId }) =>
      routes.messaging.changes(request, channelId),
);
