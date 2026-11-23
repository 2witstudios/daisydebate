import { processRoute } from '../../../../../../../server/process-app';
import { messagingComposition } from '../../../../../../../features/messaging/composition';
type Params = Awaited<
  RouteContext<'/api/messaging/channels/[channelId]/files/[fileId]'>['params']
>;

export const runtime = 'nodejs';
export const GET = processRoute.withParams(
  messagingComposition,
  (routes) =>
    (request, { channelId, fileId }: Params) => {
      return routes.files.download(request, channelId, fileId);
    },
);
