import { processRoute } from '../../../../../../../server/process-app';
type Params = Awaited<
  RouteContext<'/api/messaging/channels/[channelId]/files/[fileId]'>['params']
>;

export const runtime = 'nodejs';
export const GET = processRoute.withParams<Params>(
  (routes) =>
    (request, { channelId, fileId }) => {
      return routes.messaging.files.download(request, channelId, fileId);
    },
);
