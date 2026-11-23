import { processRoute } from '../../../../../server/process-app';
import { messagingComposition } from '../../../../../features/messaging/composition';
type Params = Awaited<
  RouteContext<'/api/messaging/retained/[channelId]'>['params']
>;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = processRoute.withParams(
  messagingComposition,
  (routes) =>
    (request, { channelId }: Params) =>
      routes.retained.read(request, channelId),
);
