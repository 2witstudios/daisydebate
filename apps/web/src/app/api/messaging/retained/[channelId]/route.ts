import { processRouteWithParams } from '../../../../../server/process-app';
type Params = Awaited<
  RouteContext<'/api/messaging/retained/[channelId]'>['params']
>;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = processRouteWithParams<Params>(
  (routes) =>
    (request, { channelId }) =>
      routes.messaging.retained.read(request, channelId),
);
