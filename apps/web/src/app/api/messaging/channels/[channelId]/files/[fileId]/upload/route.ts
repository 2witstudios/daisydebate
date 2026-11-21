import { processRouteWithParams } from '../../../../../../../../server/process-app';
type Params = Awaited<
  RouteContext<'/api/messaging/channels/[channelId]/files/[fileId]/upload'>['params']
>;

export const runtime = 'nodejs';
export const POST = processRouteWithParams<Params>(
  (routes) =>
    (request, { channelId, fileId }) => {
      return routes.messaging.files.upload(request, channelId, fileId);
    },
);
