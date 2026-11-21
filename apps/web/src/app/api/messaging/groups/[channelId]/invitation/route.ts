import { processRoute } from '../../../../../../server/process-app';
type Params = Awaited<
  RouteContext<'/api/messaging/groups/[channelId]/invitation'>['params']
>;

export const runtime = 'nodejs';
export const GET = processRoute.withParams<Params>(
  (routes) =>
    (request, { channelId }) =>
      routes.messaging.groupInvitation(request, channelId),
);
