import { processRoute } from '../../../../../../server/process-app';
export const runtime = 'nodejs';
export async function GET(
  request: Request,
  context: { params: Promise<{ channelId: string }> },
) {
  const channelId = (await context.params).channelId;
  return processRoute(
    (routes) => (incoming) => routes.messaging.reactions(incoming, channelId),
  )(request);
}
