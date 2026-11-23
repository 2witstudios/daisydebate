import { processRoute } from '../../../../../../server/process-app';
import { messagingComposition } from '../../../../../../features/messaging/composition';
type Params = Awaited<
  RouteContext<'/api/messaging/channels/[channelId]/entry'>['params']
>;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = processRoute.withParams(
  messagingComposition,
  (routes) =>
    (request, { channelId }: Params) =>
      routes.channelEntry(request, channelId),
);
