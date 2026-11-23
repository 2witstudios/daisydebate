import { processRoute } from '../../../../../../server/process-app';
import { messagingComposition } from '../../../../../../features/messaging/composition';
type Params = Awaited<
  RouteContext<'/api/messaging/requests/[channelId]/status'>['params']
>;

export const GET = processRoute.withParams(
  messagingComposition,
  (routes) =>
    (request, { channelId }: Params) =>
      routes.requestStatus(request, channelId),
);
