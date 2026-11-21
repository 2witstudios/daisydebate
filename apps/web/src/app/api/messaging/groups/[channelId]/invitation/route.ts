import { processRouteWithParams } from '../../../../../../server/process-app';
type Params = Awaited<
  RouteContext<'/api/messaging/groups/[channelId]/invitation'>['params']
>;

export const runtime = 'nodejs';
export const GET = processRouteWithParams<Params>(
  (routes) =>
    (request, { channelId }) =>
      routes.messaging.groupInvitation(request, channelId),
);
