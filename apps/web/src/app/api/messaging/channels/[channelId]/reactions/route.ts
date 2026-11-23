import { processRoute } from '../../../../../../server/process-app';
import { messagingComposition } from '../../../../../../features/messaging/composition';
export const runtime = 'nodejs';
export async function GET(
  request: Request,
  context: { params: Promise<{ channelId: string }> },
) {
  const channelId = (await context.params).channelId;
  return processRoute(
    messagingComposition,
    (routes) => (incoming) => routes.reactions(incoming, channelId),
  )(request);
}
