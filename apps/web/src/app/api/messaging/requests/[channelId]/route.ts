import { processRoute } from '../../../../../server/process-app';
import { messagingComposition } from '../../../../../features/messaging/composition';
type Params = Awaited<
  RouteContext<'/api/messaging/requests/[channelId]'>['params']
>;

export const runtime = 'nodejs';
export const GET = processRoute.withParams(
  messagingComposition,
  (routes) =>
    (request, { channelId }: Params) =>
      routes.requestPreview(request, channelId),
);
