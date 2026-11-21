import { processRouteWithParams } from '../../../../../../../server/process-app';
type Params = Awaited<
  RouteContext<'/api/messaging/channels/[channelId]/files/discard'>['params']
>;

export const runtime = 'nodejs';
export const POST = processRouteWithParams<Params>(
  (routes) =>
    (request, { channelId }) =>
      routes.messaging.files.discard(request, channelId),
);
