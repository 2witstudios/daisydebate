import { processRouteWithParams } from '../../../../../../server/process-app';
type Params = Awaited<
  RouteContext<'/api/messaging/channels/[channelId]/entry'>['params']
>;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = processRouteWithParams<Params>(
  (routes) =>
    (request, { channelId }) =>
      routes.messaging.channelEntry(request, channelId),
);
